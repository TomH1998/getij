// Getij: een 3D-walvishaai die meezwemt tijdens het scrollen, en water dat donkerder wordt met de diepte.
// De haai is volledig in code opgebouwd (geen extern 3D-model). Zonder WebGL blijft alleen het waterkleurverloop over.
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

  // Houding van de haai per sectie: x/y als deel van de halve schermbreedte/-hoogte, yaw = zwemrichting
  var POSES = [
    { x: 0.46, y: -0.08, yaw: -1.1, pitch: 0.05, s: 1.15 },  // oppervlak
    { x: 0.55, y: 0.00, yaw: -2.3, pitch: 0.00, s: 0.90 },   // waarom de oceaan ertoe doet
    { x: -0.55, y: -0.05, yaw: 1.2, pitch: -0.18, s: 0.85 }, // bedreigingen, duikt
    { x: 0.50, y: 0.10, yaw: -1.6, pitch: -0.10, s: 0.70 },  // quote
    { x: -0.55, y: 0.00, yaw: 2.0, pitch: 0.00, s: 0.75 },   // oplossingen
    { x: 0.55, y: -0.05, yaw: -1.3, pitch: 0.05, s: 0.70 },  // wat jij kunt doen
    { x: -0.55, y: 0.05, yaw: 1.4, pitch: 0.20, s: 0.80 }    // terug naar de kust, stijgt
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
    var pose = { x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e), yaw: lerp(a.yaw, b.yaw, e), pitch: lerp(a.pitch, b.pitch, e), s: lerp(a.s, b.s, e) };
    var heroEnd = sections[0] ? sections[0].getBoundingClientRect().bottom : 0;
    return { page: page, pose: pose, pastHero: heroEnd < window.innerHeight * 0.4 };
  }

  function paintWater(page) {
    var c = waterAt(page);
    water.style.backgroundColor = 'rgb(' + c.join(',') + ')';
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
  holder.add(shark);
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
      holder.remove(shark);
      holder.add(orca);
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
  var flakes = new T.Points(flakeGeo, new T.PointsMaterial({ color: 0xe8f1f0, size: 0.035, transparent: true, opacity: 0.55, depthWrite: false }));
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
    var w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    narrow = w < 1100;
  }
  window.addEventListener('resize', resize);
  resize();

  var cur = null, phase = 0, yOff = 0, last = performance.now();
  var fogCol = new T.Color();
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    var st = scrollState();
    var target = reduce ? POSES[0] : st.pose;
    if (!cur || reduce) cur = { x: target.x, y: target.y, yaw: target.yaw, pitch: target.pitch, s: target.s };
    else for (var k in cur) cur[k] += (target[k] - cur[k]) * Math.min(1, dt * 2.4);

    var halfH = Math.tan((camera.fov / 2) * Math.PI / 180) * camera.position.z, halfW = halfH * camera.aspect;
    var xf = narrow ? 0.45 : 1;
    // op smalle schermen zwemt de haai in de opening onder de tekst, daarna op de achtergrond
    var drop = narrow && !st.pastHero ? -0.66 : 0;
    yOff += (drop - yOff) * (reduce ? 1 : Math.min(1, dt * 2.4));
    holder.position.set(cur.x * halfW * xf, (cur.y + yOff) * halfH + (reduce ? 0 : Math.sin(now / 1700) * 0.08), 0);
    holder.rotation.set(cur.pitch, cur.yaw, reduce ? 0 : Math.sin(now / 2300) * 0.05);
    holder.scale.setScalar(cur.s * (narrow ? Math.min(1, camera.aspect * 0.9 + 0.25) : 1));

    if (!reduce) phase += dt * 3.1;
    if (orca) { if (mixer) mixer.update(reduce ? 0 : dt * 0.55); }
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
        if (fp[f * 3 + 1] < -6) fp[f * 3 + 1] = 6;
      }
      flakeGeo.attributes.position.needsUpdate = true;
    }

    var hide = reduce ? st.pastHero : false;
    canvas.style.opacity = hide ? '0' : (narrow ? (st.pastHero ? '0.32' : '0.75') : '1');
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
