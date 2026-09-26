import * as THREE from 'three';
import type { EnemyType, Intent } from '../ai/types';

export interface EnemyStats {
  hp: number;
  speed: number;
  radius: number;
  hoverY: number;
  score: number;
  /** Melee damage (drone/brute) or bolt damage (gunner). */
  damage: number;
  attackCooldown: number;
  /** Ranged units hold this distance on chase. 0 = melee. */
  range: number;
  flankRadius: number;
  regen: number;
}

export const STATS: Record<EnemyType, EnemyStats> = {
  drone: { hp: 30, speed: 9, radius: 0.7, hoverY: 1.3, score: 100, damage: 8, attackCooldown: 0.8, range: 0, flankRadius: 5, regen: 5 },
  gunner: { hp: 45, speed: 6.5, radius: 0.85, hoverY: 1.6, score: 150, damage: 7, attackCooldown: 1.4, range: 16, flankRadius: 15, regen: 5 },
  brute: { hp: 180, speed: 4.2, radius: 1.4, hoverY: 1.5, score: 400, damage: 22, attackCooldown: 1.4, range: 0, flankRadius: 7, regen: 10 },
};

export const INTENT_COLOR: Record<Intent, THREE.Color> = {
  chase: new THREE.Color().setRGB(3.2, 0.35, 0.6),
  flank: new THREE.Color().setRGB(3.2, 1.5, 0.15),
  retreat: new THREE.Color().setRGB(0.35, 2.2, 3.2),
};

// ---- shared geometry ----
const G = {
  droneCore: new THREE.OctahedronGeometry(0.36, 0),
  droneRing: new THREE.TorusGeometry(0.72, 0.045, 6, 40),
  droneFin: new THREE.BoxGeometry(0.08, 0.5, 0.7),
  gunnerBody: new THREE.DodecahedronGeometry(0.62, 0),
  gunnerEye: new THREE.BoxGeometry(0.44, 0.1, 0.1),
  gunnerBarrel: new THREE.BoxGeometry(0.1, 0.1, 0.7),
  gunnerHalo: new THREE.TorusGeometry(0.5, 0.03, 6, 32),
  bruteBody: new THREE.IcosahedronGeometry(1.1, 0),
  bruteShield: new THREE.CircleGeometry(1.25, 6),
  bruteEye: new THREE.BoxGeometry(0.7, 0.12, 0.12),
};
const bruteEdges = new THREE.EdgesGeometry(G.bruteBody);

export interface EnemyVisual {
  root: THREE.Group;
  body: THREE.MeshStandardMaterial;
  accent: THREE.MeshBasicMaterial;
  spinner?: THREE.Object3D;
  shield?: THREE.Mesh;
  muzzle?: THREE.Object3D;
}

export function buildEnemyVisual(type: EnemyType): EnemyVisual {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x141a26, metalness: 0.8, roughness: 0.35, flatShading: true });
  const accent = new THREE.MeshBasicMaterial({ color: INTENT_COLOR.chase.clone() });
  const v: EnemyVisual = { root, body, accent };

  if (type === 'drone') {
    root.add(new THREE.Mesh(G.droneCore, accent));
    const ring = new THREE.Mesh(G.droneRing, accent);
    ring.rotation.x = Math.PI / 2;
    const spinner = new THREE.Group();
    spinner.add(ring);
    for (const s of [-1, 1]) {
      const fin = new THREE.Mesh(G.droneFin, body);
      fin.position.x = 0.55 * s;
      spinner.add(fin);
    }
    root.add(spinner);
    v.spinner = spinner;
  } else if (type === 'gunner') {
    root.add(new THREE.Mesh(G.gunnerBody, body));
    const eye = new THREE.Mesh(G.gunnerEye, accent);
    eye.position.set(0, 0.08, -0.55);
    root.add(eye);
    for (const s of [-1, 1]) {
      const barrel = new THREE.Mesh(G.gunnerBarrel, body);
      barrel.position.set(0.32 * s, -0.18, -0.55);
      root.add(barrel);
    }
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, -0.18, -0.95);
    root.add(muzzle);
    v.muzzle = muzzle;
    const halo = new THREE.Mesh(G.gunnerHalo, accent);
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.72;
    root.add(halo);
    v.spinner = halo;
  } else {
    root.add(new THREE.Mesh(G.bruteBody, body));
    root.add(new THREE.LineSegments(bruteEdges, accent));
    const eye = new THREE.Mesh(G.bruteEye, accent);
    eye.position.set(0, 0.25, -0.98);
    root.add(eye);
    const shieldMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(0.4, 0.9, 1.6),
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const shield = new THREE.Mesh(G.bruteShield, shieldMat);
    shield.position.z = -1.45;
    shield.rotation.y = Math.PI;
    root.add(shield);
    v.shield = shield;
  }
  return v;
}

// ---- intent icons (drawn once to canvas textures) ----
function iconTexture(intent: Intent): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#fff';
  g.fillStyle = '#fff';
  g.lineWidth = 6;
  g.lineCap = g.lineJoin = 'round';
  g.beginPath();
  if (intent === 'chase') {
    // double chevron pointing down (towards target)
    for (const y of [16, 32]) {
      g.moveTo(14, y);
      g.lineTo(32, y + 14);
      g.lineTo(50, y);
    }
    g.stroke();
  } else if (intent === 'flank') {
    // curved arrow
    g.arc(32, 34, 18, Math.PI * 1.05, Math.PI * 1.95);
    g.stroke();
    g.beginPath();
    g.moveTo(52, 22);
    g.lineTo(50, 38);
    g.lineTo(38, 30);
    g.closePath();
    g.fill();
  } else {
    // shield
    g.moveTo(32, 8);
    g.lineTo(52, 16);
    g.lineTo(48, 40);
    g.lineTo(32, 56);
    g.lineTo(16, 40);
    g.lineTo(12, 16);
    g.closePath();
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let iconMats: Record<Intent, THREE.SpriteMaterial> | null = null;
export function intentIconMaterial(intent: Intent): THREE.SpriteMaterial {
  iconMats ??= {
    chase: new THREE.SpriteMaterial({ map: iconTexture('chase'), color: INTENT_COLOR.chase, depthWrite: false, transparent: true }),
    flank: new THREE.SpriteMaterial({ map: iconTexture('flank'), color: INTENT_COLOR.flank, depthWrite: false, transparent: true }),
    retreat: new THREE.SpriteMaterial({ map: iconTexture('retreat'), color: INTENT_COLOR.retreat, depthWrite: false, transparent: true }),
  };
  return iconMats[intent];
}
