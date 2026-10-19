// Loads data/tashkent.json (built by tools/build-map.mjs) and converts it to metres.

const ring = (flat) => { const r = new Float32Array(flat.length); for (let i = 0; i < flat.length; i++) r[i] = flat[i] / 10; return r; };
const pt = (p) => ({ name: p.n || '', x: p.x / 10, z: p.z / 10 });
const box = (b) => ({ minX: b.minX / 10, maxX: b.maxX / 10, minZ: b.minZ / 10, maxZ: b.maxZ / 10 });

export async function loadMapData(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 6.5e6;
  let text;
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress?.(Math.min(1, got / total));
    }
    const all = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    text = new TextDecoder().decode(all);
  } else {
    text = await res.text();
  }
  return decode(JSON.parse(text));
}

function decode(j) {
  const trees = new Float32Array(j.trees.length);
  for (let i = 0; i < j.trees.length; i += 4) {
    trees[i] = j.trees[i] / 10; trees[i + 1] = j.trees[i + 1] / 10; trees[i + 2] = j.trees[i + 2] / 100; trees[i + 3] = j.trees[i + 3];
  }
  return {
    attribution: j.attribution,
    origin: j.origin,
    bounds: box(j.bounds),
    scenery: box(j.scenery),
    names: j.names,
    buildings: j.buildings.map((b) => ({
      ring: ring(b.p), holes: (b.ho || []).map(ring), h: b.h / 10, minH: (b.m || 0) / 10, style: b.s,
      color: b.c, roof: b.rf, roofColor: b.rc, roofH: (b.rh || 0) / 10, solid: !b.nc, render: !b.nr,
    })),
    roads: j.roads.map((r) => ({ cls: r.t, w: r.w / 10, name: r.n, oneway: r.o, lanes: r.l, bridge: r.b, pts: ring(r.p) })),
    plazas: j.plazas.map((p) => ({ kind: p.k, ring: ring(p.p), holes: (p.ho || []).map(ring) })),
    water: j.water.map((w) => ({ ring: ring(w.p), holes: (w.ho || []).map(ring) })),
    waterways: j.waterways.map((w) => ({ w: w.w / 10, pts: ring(w.p) })),
    greens: j.greens.map((g) => ({ kind: g.k, ring: ring(g.p), holes: (g.ho || []).map(ring) })),
    rails: j.rails.map((r) => ({ pts: ring(r.p) })),
    trees,
    graph: j.graph,
    landmarks: j.landmarks.map((l) => ({ id: l.id, name: l.n, x: l.x / 10, z: l.z / 10, h: l.h, ring: l.ring ? ring(l.ring) : null })),
    hospitals: j.hospitals.map(pt),
    police: j.police.map(pt),
    carWashes: j.carWashes.map(pt),
    fuel: j.fuel.map(pt),
    places: j.places.map((p) => ({ ...pt(p), rank: p.r })),
    metro: j.metro.map((s) => ({ name: s.n, entrances: s.e.map((e) => [e[0] / 10, e[1] / 10]) })),
    busStops: j.busStops.map((b) => [b[0] / 10, b[1] / 10]),
  };
}
