// Getij: een 3D-orka die meezwemt tijdens het scrollen, in water dat per pixel wordt berekend en donkerder wordt met de diepte.
// Lukt het laden van het orka-model niet, dan zwemt de in code gebouwde walvishaai. Zonder WebGL blijft alleen het kleurverloop over.
(function () {
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var water = document.querySelector('.water');
  var canvas = document.getElementById('whale');
  var sections = [].slice.call(document.querySelectorAll('main > section'));

  // Waterkleur per positie op de pagina (0 = oppervlak, 1 = onderaan, terug aan de kust)
  var WATER = [
    [0.00, [17, 102, 123]],
    [0.12, [13, 84, 104]],
    [0.30, [9, 58, 80]],
    [0.55, [6, 36, 54]],
    [0.80, [3, 15, 24]],
    [1.00, [10, 52, 68]]
  ];
  function waterAt(p) {
    for (var i = 1; i < WATER.length; i++) {
      if (p <= WATER[i][0]) {
        var a = WATER[i - 1], b = WATER[i], f = (p - a[0]) / (b[0] - a[0]);
        return a[1].map(function (v, k) { return Math.round(v + (b[1][k] - v) * f); });
      }
    }
    return WATER[WATER.length - 1][1];
  }

  // Plek van het dier per sectie: x/y als deel van de halve schermbreedte/-hoogte, s = formaat.
  // De kijkrichting staat hier bewust niet in: die volgt uit de zwemrichting (zie frame()).
  var POSES = [
    { x: 0.46, y: -0.08, s: 1.15 },  // oppervlak
    { x: 0.50, y: 0.00, s: 0.90 },   // waarom de oceaan ertoe doet
    { x: -0.55, y: -0.05, s: 0.85 }, // bedreigingen
    { x: 0.50, y: 0.10, s: 0.70 },   // quote
    { x: -0.55, y: 0.00, s: 0.75 },  // oplossingen
    { x: 0.55, y: -0.05, s: 0.70 },  // wat jij kunt doen
    { x: -0.55, y: 0.05, s: 0.80 }   // terug naar de kust
  ];

  function lerp(a, b, f) { return a + (b - a) * f; }
  function ease(f) { return f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2; }

  function scrollState() {
    var max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    var page = Math.min(1, Math.max(0, window.scrollY / max));
    var mid = window.innerHeight * 0.5, idx = 0, f = 0;
    for (var i = 0; i < sections.length; i++) {
      var r = sections[i].getBoundingClientRect();
      if (r.top <= mid) { idx = i; f = Math.min(1, Math.max(0, (mid - r.top) / r.height)); }
    }
    var a = POSES[Math.min(idx, POSES.length - 1)], b = POSES[Math.min(idx + 1, POSES.length - 1)], e = ease(f);
    var pose = { x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e), s: lerp(a.s, b.s, e) };
    var heroEnd = sections[0] ? sections[0].getBoundingClientRect().bottom : 0;
    return { page: page, pose: pose, pastHero: heroEnd < window.innerHeight * 0.4 };
  }

  var lastBody = "";
  function paintWater(page) {
    var c = waterAt(page);
    water.style.backgroundColor = 'rgb(' + c.join(',') + ')';
    // Safari op de iPhone tekent vaste lagen niet door achter zijn knoppenbalk onderin, maar toont daar
    // de achtergrond van de pagina. Die kleurt daarom mee met het water onderin beeld (de shader is
    // daar ongeveer 0,34 x de waterkleur), zodat er geen donkere strook ontstaat.
    var k = document.documentElement.classList.contains('real-water') ? 0.34 : 1;
    var b = 'rgb(' + c.map(function (v) { return Math.round(v * k); }).join(',') + ')';
    if (b !== lastBody) { document.body.style.backgroundColor = b; lastBody = b; }
    return c;
  }

  if (!canvas || !window.THREE) {
    window.addEventListener('scroll', function () { paintWater(scrollState().page); }, { passive: true });
    paintWater(scrollState().page);
    return;
  }

  var T = window.THREE;
  var renderer;
  try {
    renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  } catch (e) {
    canvas.remove();
    window.addEventListener('scroll', function () { paintWater(scrollState().page); }, { passive: true });
    paintWater(scrollState().page);
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);

  var scene = new T.Scene();
  scene.fog = new T.Fog(0x0d5468, 4, 30);
  var camera = new T.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 10);

  var hemi = new T.HemisphereLight(0xcff6ff, 0x0a2230, 1.1);
  scene.add(hemi);
  var sun = new T.DirectionalLight(0xffffff, 0.9);
  sun.position.set(2, 8, 4);
  scene.add(sun);
  var rim = new T.DirectionalLight(0x7fe3e0, 0.0);
  rim.position.set(-4, -2, -6);
  scene.add(rim);

  // ---------- het water zelf: per pixel berekend in plaats van een egale kleur ----------
  // Lichtbundels die door het water wiegen, het golvende oppervlak van onderen gezien met
  // dansende lichtvlekken (caustics), licht dat met de diepte verdwijnt, vignet en filmkorrel.
  var waterMat = new T.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uPage: { value: 0 },
      uAspect: { value: 1 },
      uWater: { value: new T.Vector3(17 / 255, 102 / 255, 123 / 255) }
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: [
      'precision highp float;',
      'uniform float uTime, uPage, uAspect; uniform vec3 uWater; varying vec2 vUv;',
      'float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }',
      'float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);',
      '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }',
      // elke laag gedraaid, zodat er nergens een raster zichtbaar wordt
      'const mat2 ROT = mat2(1.6, 1.2, -1.2, 1.6);',
      'float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * noise(p); p = ROT * p + vec2(1.7, 9.2); a *= 0.5; } return v; }',
      // caustics: dunne heldere lijnen waar golven het licht bundelen
      'float caustic(vec2 p, float t){ float c = 0.0;',
      '  for (int i = 0; i < 2; i++){ float fi = float(i);',
      '    vec2 q = p * (1.0 + fi * 0.7) + vec2(sin(t * 0.21 + fi * 1.3), cos(t * 0.17 + fi * 2.1)) * 1.4;',
      '    float n = fbm(q + t * 0.06 * (fi + 1.0));',
      '    c += pow(1.0 - abs(n * 2.0 - 1.0), 7.0); }',
      '  return c * 0.5; }',
      'void main(){',
      '  vec2 uv = vUv; vec2 p = vec2((uv.x - 0.5) * uAspect, uv.y); float t = uTime;',
      // licht van boven: het water is helder bij het oppervlak en wordt naar onderen donker
      '  float lift = smoothstep(-0.15, 1.15, uv.y);',
      '  vec3 col = mix(uWater * 0.36, uWater * 1.5 + vec3(0.015, 0.05, 0.05), pow(lift, 1.35));',
      '  float sun = 1.0 - smoothstep(0.0, 0.55, uPage);',
      // lichtbundels, schuin vanaf het oppervlak, langzaam wiegend
      '  float rx = p.x + (1.0 - uv.y) * 0.38;',
      '  float r1 = noise(vec2(rx * 3.2 + sin(t * 0.05) * 0.6, t * 0.06));',
      '  float r2 = noise(vec2(rx * 7.5 - t * 0.02, t * 0.09 + 4.0));',
      '  float rays = smoothstep(0.42, 1.0, r1 * 0.65 + r2 * 0.45);',
      '  rays *= pow(uv.y, 1.7) * (0.55 + 0.45 * fbm(vec2(rx * 2.0, uv.y * 3.0 - t * 0.05)));',
      '  col += vec3(0.55, 0.86, 0.86) * rays * (0.10 + 0.30 * sun);',
      // het oppervlak van onderen gezien; schuift omhoog weg zodra je naar beneden scrolt
      '  float sy = uv.y - (0.84 + uPage * 7.0);',
      '  float surf = smoothstep(-0.2, 0.08, sy);',
      '  float c = caustic(vec2(p.x * 2.4, uv.y * 3.0), t);',
      '  float ripple = fbm(vec2(p.x * 6.0 + t * 0.12, uv.y * 26.0 - t * 0.35));',
      '  col += vec3(0.58, 0.80, 0.84) * surf * (0.06 + 0.42 * c + 0.12 * ripple);',
      // zachte lichtvlekken die door het bovenste water spelen
      '  float cz = caustic(p * 2.2 + vec2(0.0, uPage * 4.0), t * 0.7);',
      '  col += vec3(0.45, 0.76, 0.76) * cz * 0.09 * sun * smoothstep(0.15, 1.0, uv.y);',
      // vignet en korrel: geen vlakke kleur, geen banding
      '  float v = smoothstep(1.3, 0.3, length((uv - vec2(0.5, 0.58)) * vec2(uAspect * 0.55, 1.0)));',
      '  col *= mix(0.7, 1.0, v);',
      '  col += (hash(uv * vec2(1733.0, 977.0) + fract(t * 0.37)) - 0.5) * 0.022;',
      '  col = col / (1.0 + max(col - 0.6, 0.0) * 1.4);', // zachte bovengrens: licht brandt niet uit
      '  gl_FragColor = vec4(col, 1.0);',
      '}'
    ].join('\n')
  });
  var waterQuad = new T.Mesh(new T.PlaneGeometry(2, 2), waterMat);
  waterQuad.frustumCulled = false;
  waterQuad.renderOrder = -10;
  scene.add(waterQuad);
  document.documentElement.classList.add('real-water');

  // ---------- het lijf: ringen langs de lengte-as, neus op +z ----------
  var L = 5.2, RINGS = 64, SEG = 36;
  function radius(t) {
    if (t < 0.12) return 0.06 + 0.56 * Math.sqrt(t / 0.12);
    var u = (t - 0.12) / 0.88;
    return 0.62 * Math.pow(1 - u, 1.35) + 0.06 * u;
  }
  function widthScale(t) { return lerp(1.28, 0.62, Math.pow(t, 0.8)); }
  function heightScale(t) { return lerp(0.66, 1.0, t); }

  var pos = [], col = [], idx = [], ringT = [];
  var top = new T.Color(0x34444f), belly = new T.Color(0xdfe5e7), tmp = new T.Color();
  for (var i = 0; i <= RINGS; i++) {
    var t = i / RINGS, r = radius(t), z = L / 2 - t * L;
    for (var j = 0; j <= SEG; j++) {
      var a = (j / SEG) * Math.PI * 2;
      var x = Math.cos(a) * r * widthScale(t);
      var y = Math.sin(a) * r * heightScale(t);
      if (y < 0) y *= 0.82; // platte buik
      pos.push(x, y, z);
      var shade = Math.min(1, Math.max(0, (-Math.sin(a) + 0.15) * 1.6));
      tmp.copy(top).lerp(belly, shade);
      col.push(tmp.r, tmp.g, tmp.b);
      ringT.push(t);
    }
  }
  for (i = 0; i < RINGS; i++) {
    for (j = 0; j < SEG; j++) {
      var p0 = i * (SEG + 1) + j, p1 = p0 + 1, p2 = p0 + SEG + 1, p3 = p2 + 1;
      idx.push(p0, p2, p1, p1, p2, p3);
    }
  }
  var bodyGeo = new T.BufferGeometry();
  var basePos = new Float32Array(pos);
  bodyGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(pos), 3));
  bodyGeo.setAttribute('color', new T.BufferAttribute(new Float32Array(col), 3));
  bodyGeo.setIndex(idx);
  bodyGeo.computeVertexNormals();
  var skin = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.0 });
  var finMat = new T.MeshStandardMaterial({ color: 0x2f3e49, roughness: 0.8, side: T.DoubleSide });

  var shark = new T.Group();
  var body = new T.Mesh(bodyGeo, skin);
  shark.add(body);

  // ---------- witte stippen, het herkenbare patroon ----------
  var SPOTS = 420, spotGeo = new T.SphereGeometry(1, 8, 6);
  var spotMat = new T.MeshStandardMaterial({ color: 0xeaf0f2, roughness: 0.6 });
  var spots = new T.InstancedMesh(spotGeo, spotMat, SPOTS);
  var spotBase = [], m4 = new T.Matrix4(), q = new T.Quaternion(), v3 = new T.Vector3(), sc = new T.Vector3();
  var seed = 7;
  function rand() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
  for (var s = 0; s < SPOTS; s++) {
    // gelijkmatig over de zichtbare hoogte van rug en flanken, niet opgehoopt op de rugrichel
    var st = 0.04 + rand() * 0.84, sn = -0.2 + rand() * 1.18;
    var ang = Math.asin(Math.min(1, sn)); if (rand() < 0.5) ang = Math.PI - ang;
    var rr = radius(st) * 1.005;
    var sx = Math.cos(ang) * rr * widthScale(st), sy = Math.sin(ang) * rr * heightScale(st);
    var size = (0.022 + rand() * 0.03) * (0.5 + radius(st));
    spotBase.push({ x: sx, y: sy, z: L / 2 - st * L, t: st, size: size });
  }
  shark.add(spots);

  // ---------- vinnen ----------
  function finMesh(points, depth) {
    var shape = new T.Shape();
    shape.moveTo(points[0][0], points[0][1]);
    for (var k = 1; k < points.length; k++) shape.lineTo(points[k][0], points[k][1]);
    shape.closePath();
    var g = new T.ExtrudeGeometry(shape, { depth: depth, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.02, bevelSegments: 1 });
    g.translate(0, 0, -depth / 2);
    return new T.Mesh(g, finMat);
  }
  // borstvinnen: liggend, naar achteren geveegd
  // vorm in (zijwaarts, langs het lijf): x = naar buiten, y = naar voren
  var pectoral = [[0, 0.3], [1.15, -0.45], [1.22, -0.62], [0, -0.35]];
  var finL = finMesh(pectoral, 0.04), finR = finMesh(pectoral, 0.04);
  finL.rotation.x = Math.PI / 2; finR.rotation.x = Math.PI / 2;
  var pecL = new T.Group(), pecR = new T.Group();
  pecL.add(finL); pecR.add(finR);
  pecL.rotation.z = -0.3;
  pecR.scale.x = -1; pecR.rotation.z = 0.3;
  var pecT = 0.27;
  shark.add(pecL, pecR);
  // rugvinnen: rechtop
  function dorsal(h) {
    var m = finMesh([[0.35, 0], [-0.15, h], [-0.3, h * 0.92], [-0.45, 0]], 0.05);
    m.rotation.y = -Math.PI / 2;
    var g = new T.Group(); g.add(m); return g;
  }
  var d1 = dorsal(0.78), d2 = dorsal(0.32), d1T = 0.46, d2T = 0.74;
  shark.add(d1, d2);
  // staartvin: halvemaan, bovenste lob groter
  var tailFin = finMesh([[0, 0.05], [-0.55, 1.35], [-0.8, 1.28], [-0.32, 0.08], [-0.62, -0.82], [-0.42, -0.9], [0, -0.08]], 0.05);
  tailFin.rotation.y = -Math.PI / 2;
  var tail = new T.Group(); tail.add(tailFin);
  shark.add(tail);
  // ogen en bek
  var eyeMat = new T.MeshStandardMaterial({ color: 0x0a0f12, roughness: 0.3 });
  var eyeL = new T.Mesh(new T.SphereGeometry(0.035, 10, 8), eyeMat), eyeR = eyeL.clone();
  var eT = 0.07;
  eyeL.position.set(radius(eT) * widthScale(eT) * 0.98, 0.04, L / 2 - eT * L);
  eyeR.position.set(-eyeL.position.x, 0.04, eyeL.position.z);
  var mouth = new T.Mesh(new T.BoxGeometry(0.62, 0.035, 0.05), eyeMat);
  mouth.position.set(0, -0.06, L / 2 - 0.012 * L);
  shark.add(eyeL, eyeR, mouth);

  var holder = new T.Group();
  // swim draagt de kijkrichting (yaw), het op- en neerduiken en het overhellen in bochten
  var swim = new T.Group();
  swim.rotation.order = "YXZ";
  swim.add(shark);
  holder.add(swim);
  scene.add(holder);

  // ---------- de orka: echt 3D-model met eigen zwemanimatie ----------
  // "Orca Whale Low Poly" door Rio2 (Sketchfab, Free Standard-licentie).
  // Lukt het laden niet, dan blijft de zelfgebouwde haai hierboven zwemmen.
  var orca = null, mixer = null;
  // draai zodat de kop op +z wijst, net als de haai (vastgesteld door te kijken)
  var ORCA_YAW = Math.PI / 2;
  if (T.GLTFLoader) {
    new T.GLTFLoader().load('models/orca/scene.gltf', function (gltf) {
      var model = gltf.scene;
      model.traverse(function (o) {
        if (!o.isMesh) return;
        o.frustumCulled = false; // gevild model: de standaard-bounding box klopt niet
        var m = o.material;
        m.side = T.FrontSide;
        m.flatShading = true; // de facetten mogen zichtbaar zijn: dat is de stijl
        // puur zwart verdwijnt in diep water; een heel donker leisteen blijft leesbaar
        if (m.color && m.color.r < 0.02 && m.color.g < 0.02) m.color.setHex(0x10181d);
        if (m.name === 'Corak_Mata') m.color.setHex(0xeef3f2);
        m.roughness = 0.55;
        m.needsUpdate = true;
      });
      // op lengte schalen en centreren
      var pivot = new T.Group();
      pivot.add(model);
      pivot.updateMatrixWorld(true);
      var box = new T.Box3().setFromObject(model), size = new T.Vector3(), mid = new T.Vector3();
      box.getSize(size); box.getCenter(mid);
      var len = Math.max(size.x, size.z) || 1, k = (L * 0.8) / len; // iets kleiner: de rugvin maakt hem hoger dan de haai
      model.position.sub(mid);
      pivot.scale.setScalar(k);
      pivot.rotation.y = ORCA_YAW;
      orca = new T.Group();
      orca.add(pivot);
      if (gltf.animations && gltf.animations.length) {
        mixer = new T.AnimationMixer(model);
        mixer.clipAction(gltf.animations[0]).play();
      }
      swim.remove(shark);
      swim.add(orca);
      if (reduce) frame(performance.now());
    }, undefined, function () { /* laat de haai staan */ });
  }

  // ---------- zeesneeuw ----------
  var N = 360, flakePos = new Float32Array(N * 3);
  for (var n = 0; n < N; n++) {
    flakePos[n * 3] = (rand() - 0.5) * 22; flakePos[n * 3 + 1] = (rand() - 0.5) * 12; flakePos[n * 3 + 2] = (rand() - 0.5) * 10 - 1;
  }
  var flakeGeo = new T.BufferGeometry();
  flakeGeo.setAttribute('position', new T.BufferAttribute(flakePos, 3));
  // zachte, ronde deeltjes; dichtbij groot en wazig, ver weg klein (perspectief)
  var dot = document.createElement('canvas'); dot.width = dot.height = 64;
  var dctx = dot.getContext('2d'), grad = dctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,255,255,0.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  dctx.fillStyle = grad; dctx.fillRect(0, 0, 64, 64);
  var flakes = new T.Points(flakeGeo, new T.PointsMaterial({ color: 0xdcecea, size: 0.07, map: new T.CanvasTexture(dot), transparent: true, opacity: 0.5, depthWrite: false, sizeAttenuation: true }));
  scene.add(flakes);

  // ---------- zwembeweging ----------
  function sway(t, phase) {
    var w = t * t;
    return 0.42 * w * Math.sin(phase - t * 5.2);
  }
  function swayAngle(t, phase) {
    var h = 0.01;
    return Math.atan2(sway(t + h, phase) - sway(t, phase), h * L);
  }
  function deform(phase) {
    var arr = bodyGeo.attributes.position.array;
    for (var k = 0; k < ringT.length; k++) {
      arr[k * 3] = basePos[k * 3] + sway(ringT[k], phase);
    }
    bodyGeo.attributes.position.needsUpdate = true;
    bodyGeo.computeVertexNormals();
    for (var s = 0; s < SPOTS; s++) {
      var b = spotBase[s];
      v3.set(b.x + sway(b.t, phase), b.y, b.z);
      sc.set(b.size, b.size * 0.6, b.size);
      m4.compose(v3, q, sc);
      spots.setMatrixAt(s, m4);
    }
    spots.instanceMatrix.needsUpdate = true;
    function place(g, t, y, x) {
      g.position.set((x || 0) + sway(t, phase), y, L / 2 - t * L);
    }
    place(pecL, pecT, -0.14, radius(pecT) * widthScale(pecT) * 0.85);
    place(pecR, pecT, -0.14, -radius(pecT) * widthScale(pecT) * 0.85);
    place(d1, d1T, radius(d1T) * heightScale(d1T) * 0.92);
    place(d2, d2T, radius(d2T) * heightScale(d2T) * 0.9);
    place(tail, 0.995, 0);
    tail.rotation.y = -swayAngle(0.98, phase) * 1.6;
    d1.rotation.y = -swayAngle(d1T, phase);
    d2.rotation.y = -swayAngle(d2T, phase);
  }

  // ---------- formaat ----------
  var narrow = false;
  function resize() {
    // de canvas is 100lvh hoog: maat van de canvas zelf gebruiken, niet van het (wisselende) venster
    var w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    narrow = window.innerWidth < 1100;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- zwemgedrag ----------
  // Het dier volgt niet de scrollbalk maar zwemt zelf: altijd vooruit, in de richting van zijn kop,
  // over een wijde ovale ronde door de diepte. Bochten hebben een maximale draaisnelheid.
  // Vanaf 200 m diepte zwemt hij in een rustige boog het beeld uit; terug omhoog komt hij weer aanzwemmen.
  var depthSecs = [].slice.call(document.querySelectorAll('[data-depth]'));
  function depthNow() {
    var mid = window.innerHeight * 0.5, d = 0;
    for (var i = 0; i < depthSecs.length; i++) {
      var r = depthSecs[i].getBoundingClientRect();
      if (r.top <= mid) {
        var d0 = +depthSecs[i].dataset.depth, d1 = depthSecs[i + 1] ? +depthSecs[i + 1].dataset.depth : d0;
        d = d0 + (d1 - d0) * Math.min(1, Math.max(0, (mid - r.top) / r.height));
      }
    }
    return d;
  }
  var CAMZ = camera.position.z;
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function wrapAngle(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

  // ---- elke ronde anders: breedte, diepte, kanteling, hoogte, golf en tempo wisselen per ronde ----
  // (dezelfde rekenregels zijn vooraf 20 minuten gesimuleerd op desktop-, tablet- en telefoonformaten)
  function randomLap(isNarrow) {
    var r = function (a, b) { return a + (b - a) * Math.random(); };
    return isNarrow
      ? { aF: r(0.68, 0.8), B: r(1.35, 1.8), tilt: r(-0.15, 0.15), yF: r(-0.12, 0.12), wave: r(0.08, 0.22), k: Math.random() < 0.5 ? 1 : 2, vF: r(0.9, 1.1) }
      : { aF: r(0.95, 1.12), B: r(1.9, 2.5), tilt: r(-0.2, 0.2), yF: r(-0.14, 0.08), wave: r(0.1, 0.3), k: Math.random() < 0.5 ? 1 : 2, vF: r(0.88, 1.08) };
  }
  function lerpLap(cur, tgt, f) { for (var key in cur) if (key !== 'k') cur[key] += (tgt[key] - cur[key]) * f; cur.k = tgt.k; }
  // punt op de (gekantelde) ovale ronde, en terugrekenen van positie naar plek op de ronde
  function loopPt(o, th) {
    var u = o.A * Math.sin(th), w = o.B * Math.cos(th), c = Math.cos(o.tilt), s = Math.sin(o.tilt);
    return { x: o.cx + u * c + w * s, z: -u * s + w * c };
  }
  function loopTheta(o, x, z) {
    var dx = x - o.cx, c = Math.cos(o.tilt), s = Math.sin(o.tilt);
    return Math.atan2((dx * c - z * s) / o.A, (dx * s + z * c) / o.B);
  }
  function loopHeading(o, th, dir) {
    var a = loopPt(o, th), b = loopPt(o, th + 0.01 * dir);
    return Math.atan2(b.x - a.x, b.z - a.z);
  }

  var dir = Math.random() < 0.5 ? 1 : -1; // elke bezoek linksom of rechtsom
  var lapNarrow = null, lap = null, lapTgt = null, lapAcc = 0, prevTh = null;

  // de ronde, afgestemd op het scherm en op de huidige ronde-variant
  function layout(st) {
    var halfH = Math.tan((camera.fov / 2) * Math.PI / 180) * CAMZ, halfW = halfH * camera.aspect;
    var visW = function (z) { return halfW * (CAMZ - z) / CAMZ; };
    if (lapNarrow !== narrow) { lap = randomLap(narrow); lapTgt = randomLap(narrow); lapNarrow = narrow; }
    var o = { halfH: halfH, halfW: halfW, visW: visW, tilt: lap.tilt };
    if (!narrow) {
      // breed scherm: een ronde in de vrije rechterhelft, de bochten in de diepte zijn zichtbaar en wijd
      o.s = clamp(halfW * 0.12, 0.45, 0.8);
      o.hl = 2.08 * o.s;
      o.A = 1.7 * clamp(halfW / 5.04, 1.0, 1.3) * lap.aF; o.B = lap.B;
      // zo ver mogelijk naar rechts, maar op elk punt van de ronde met de hele orka binnen beeld
      o.cx = 0;
      var room = Infinity;
      for (var k = 0; k < 48; k++) {
        var th = k / 48 * Math.PI * 2, p = loopPt(o, th), hy = loopHeading(o, th, dir);
        room = Math.min(room, visW(p.z) * 0.93 - o.hl * Math.abs(Math.sin(hy)) - 0.35 * Math.abs(Math.cos(hy)) - 0.3 - p.x);
      }
      o.cx = room;
      o.cy = (-0.06 + lap.yF) * halfH;
      o.v = 0.7 * lap.vF; o.turn = 0.5;
    } else {
      // smal scherm: een platte ronde over bijna de hele breedte, rustig tempo. Hij blijft altijd
      // grotendeels in beeld; alleen in de bocht steekt een stukje kop of staart buiten de rand.
      o.s = clamp(halfW * 0.22, 0.25, 0.75);
      o.hl = 2.08 * o.s;
      o.A = halfW * lap.aF; o.B = lap.B;
      o.cx = 0;
      o.cy = (st.pastHero ? 0 : -0.62) * halfH + lap.yF * halfH * 0.5; // in de kop onder de tekst, daarna op de achtergrond
      o.v = 0.4 * lap.vF; o.turn = 0.8;
    }
    return o;
  }

  var P = null, yaw = 0, yawRate = 0, bank = 0, pitch = 0, speed = 0;
  var mode = 'loop', leaveSide = 1, gone = false, phase = 0, last = performance.now();
  function placeOnLoop(o, th) {
    var p = loopPt(o, th);
    P = { x: p.x, y: o.cy, z: p.z };
    yaw = loopHeading(o, th, dir); yawRate = 0; speed = o.v;
  }
  var fogCol = new T.Color();
  var animalFade = 1, fadeMats = null, fadeShown = -1;
  function setAnimalOpacity(a) {
    if (Math.abs(a - fadeShown) < 0.004) return;
    fadeShown = a;
    fadeMats = [];
    swim.traverse(function (o) { if (o.material) fadeMats.push(o.material); });
    for (var i = 0; i < fadeMats.length; i++) {
      var m = fadeMats[i], tr = a < 0.999;
      if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
      m.opacity = a;
    }
  }
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    var st = scrollState();
    if (lap && !reduce) lerpLap(lap, lapTgt, Math.min(1, dt * 0.12));
    var o = layout(st);
    var depth = depthNow();
    var hl = orca ? o.hl : 2.6 * o.s;
    if (!P) placeOnLoop(o, -0.35 * dir);

    // dieper dan 200 m: wegzwemmen; boven 170 m: weer meedoen (verschil voorkomt heen-en-weer)
    if (mode === 'loop' && depth >= 200) { mode = 'leave'; leaveSide = narrow ? (Math.sin(yaw) >= 0 ? 1 : -1) : 1; } // breed scherm: weg via de vrije rechterkant
    else if (mode === 'leave' && depth < 170) { mode = 'loop'; }
    if (mode === 'loop' && gone) {
      // terugkomen: buiten beeld rechts beginnen, naar links zwemmend
      P = { x: o.visW(0) + hl * 0.8, y: o.cy, z: 0 }; // kop staat al net in beeld: meteen zichtbaar
      yaw = -Math.PI / 2; yawRate = 0; speed = o.v; gone = false;
    }

    if (reduce) {
      // geen beweging gewenst: een stil, mooi profiel, en weg vanaf 200 m
      placeOnLoop(o, -0.35 * dir);
      gone = depth >= 200;
    } else if (!gone) {
      var tx, ty, tz, vT;
      if (mode === 'loop') {
        // achtervolg een punt iets verderop op de ronde: altijd vooruit, nooit terug
        var thn = loopTheta(o, P.x, P.z);
        // ronde voltooid? dan langzaam overgaan naar een nieuwe variant
        if (prevTh !== null) lapAcc += wrapAngle(thn - prevTh) * dir;
        prevTh = thn;
        if (lapAcc >= 2 * Math.PI) { lapAcc = 0; lapTgt = randomLap(narrow); }
        var th = thn + 0.55 * dir;
        var c = loopPt(o, th);
        tx = c.x; tz = c.z; ty = o.cy + lap.wave * Math.sin(th * lap.k);
        var dist = Math.hypot(c.x - P.x, c.z - P.z);
        vT = o.v * (dist > 2.2 ? 1.25 : 1);
      } else {
        tx = leaveSide * (o.halfW * 2 + 10); tz = 0; ty = o.cy; vT = o.v * 1.4;
      }
      speed += (vT - speed) * Math.min(1, dt * 0.6);
      // sturen met een begrensde, zacht aanzwellende draaisnelheid
      var diff = wrapAngle(Math.atan2(tx - P.x, tz - P.z) - yaw);
      var rateT = clamp(diff * 0.9, -o.turn, o.turn);
      yawRate += (rateT - yawRate) * Math.min(1, dt * 1.2);
      yaw = wrapAngle(yaw + yawRate * dt);
      P.x += Math.sin(yaw) * speed * dt;
      P.z += Math.cos(yaw) * speed * dt;
      var vy = clamp((ty - P.y) * 0.5, -0.28, 0.28);
      P.y += vy * dt;
      pitch += (Math.atan2(vy, speed) * 0.8 - pitch) * Math.min(1, dt * 1.5);
      bank += (clamp(-yawRate * 0.55, -0.28, 0.28) - bank) * Math.min(1, dt * 2);
      // helemaal uit beeld? dan verbergen tot je weer omhoog scrolt
      if (mode === 'leave' && (Math.abs(P.x) - hl > o.visW(P.z) + 0.3 || P.z < -14 || P.z > 7)) gone = true;
    }
    if (reduce) { gone = depth >= 200; }

    holder.position.set(P.x, P.y + (reduce ? 0 : Math.sin(now / 1700) * 0.05), P.z);
    holder.scale.setScalar(o.s);
    swim.rotation.set(-pitch, yaw, bank + (reduce ? 0 : Math.sin(now / 2300) * 0.03));
    // sneller zwemmen = sneller slaan met de staart
    if (mixer) mixer.timeScale = clamp(0.6 + (speed - 0.6) * 0.9, 0.5, 1.3);

    if (!reduce) phase += dt * 3.1;
    if (orca) { if (mixer) mixer.update(reduce ? 0 : dt); }
    else deform(phase);

    var c = paintWater(st.page);
    fogCol.setRGB(c[0] / 255, c[1] / 255, c[2] / 255);
    scene.fog.color.copy(fogCol);
    var deep = Math.min(1, st.page / 0.8);
    hemi.intensity = lerp(1.1, 0.35, deep);
    sun.intensity = lerp(0.9, 0.15, deep);
    rim.intensity = lerp(0.0, 0.9, deep);

    if (!reduce) {
      var fp = flakeGeo.attributes.position.array;
      for (var f = 0; f < N; f++) {
        fp[f * 3 + 1] -= dt * 0.12;
        fp[f * 3] += Math.sin(now / 2400 + f) * dt * 0.03; // zachte stroming
        if (fp[f * 3 + 1] < -6) fp[f * 3 + 1] = 6;
      }
      flakeGeo.attributes.position.needsUpdate = true;
    }

    // het water blijft altijd volledig zichtbaar; alleen het dier wordt op smalle schermen zachter
    waterMat.uniforms.uTime.value = reduce ? 4 : now / 1000;
    waterMat.uniforms.uPage.value = st.page;
    waterMat.uniforms.uAspect.value = camera.aspect;
    waterMat.uniforms.uWater.value.set(c[0] / 255, c[1] / 255, c[2] / 255);
    swim.visible = !gone;
    var fadeT = narrow ? (st.pastHero ? 0.32 : 0.75) : 1;
    animalFade += (fadeT - animalFade) * (reduce ? 1 : Math.min(1, dt * 2));
    setAnimalOpacity(animalFade);
    renderer.render(scene, camera);
    if (!reduce) requestAnimationFrame(frame);
  }
  if (reduce) {
    window.addEventListener('scroll', function () { frame(performance.now()); }, { passive: true });
    frame(performance.now());
  } else {
    requestAnimationFrame(frame);
  }
})();
