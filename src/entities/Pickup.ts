import * as THREE from 'three';

const geo = new THREE.OctahedronGeometry(0.32, 0);
const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.4, 3, 1.2) });
const ringGeo = new THREE.TorusGeometry(0.55, 0.03, 6, 32);

/** Health orbs dropped by enemies. */
export class Pickups {
  readonly group = new THREE.Group();
  private items: { mesh: THREE.Group; life: number }[] = [];

  spawn(x: number, z: number) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo, mat));
    const ring = new THREE.Mesh(ringGeo, mat);
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    g.position.set(x, 0.8, z);
    this.group.add(g);
    this.items.push({ mesh: g, life: 12 });
  }

  /** Returns number of orbs collected this frame. */
  update(dt: number, time: number, player: THREE.Vector3): number {
    let got = 0;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life -= dt;
      const m = it.mesh;
      m.rotation.y += dt * 2.5;
      m.position.y = 0.8 + Math.sin(time * 3 + i) * 0.15;
      m.visible = it.life > 3 || Math.sin(time * 20) > 0; // blink before expiring
      const d = Math.hypot(m.position.x - player.x, m.position.z - player.z);
      if (d < 1.6) got++;
      if (d < 1.6 || it.life <= 0) {
        this.group.remove(m);
        this.items.splice(i, 1);
      }
    }
    return got;
  }

  positions() {
    return this.items.map((i) => i.mesh.position);
  }

  clear() {
    for (const it of this.items) this.group.remove(it.mesh);
    this.items = [];
  }
}
