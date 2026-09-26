import * as THREE from 'three';

/** Gradient sky dome with a horizon glow plus slowly drifting luminous dust. */
export class Sky {
  readonly group = new THREE.Group();
  private dust: THREE.Points;
  private dustMat: THREE.ShaderMaterial;

  constructor() {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(300, 48, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {},
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            float h = vDir.y;
            vec3 top = vec3(0.004, 0.006, 0.018);
            vec3 mid = vec3(0.012, 0.02, 0.05);
            vec3 col = mix(mid, top, smoothstep(0.0, 0.6, h));
            // violet/cyan horizon band
            float hb = h * 9.0;
            float band = exp(-hb * hb);
            float az = atan(vDir.z, vDir.x);
            vec3 bandCol = mix(vec3(0.12, 0.03, 0.22), vec3(0.02, 0.14, 0.22), 0.5 + 0.5 * sin(az * 2.0));
            col += bandCol * band * 0.9;
            col = mix(col, vec3(0.019, 0.027, 0.05), (1.0 - smoothstep(-0.2, 0.0, h)));
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
    dome.renderOrder = -10;
    this.group.add(dome);

    const count = 900;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = Math.sqrt(Math.random()) * 70;
      const a = Math.random() * Math.PI * 2;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.random() * 22 + 0.5;
      pos[i * 3 + 2] = Math.sin(a) * r;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.dustMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: Math.min(devicePixelRatio, 1.75) } },
      vertexShader: /* glsl */ `
        attribute float seed;
        uniform float uTime;
        uniform float uPixelRatio;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          p.y += sin(uTime * 0.3 + seed * 40.0) * 0.8;
          p.x += sin(uTime * 0.13 + seed * 17.0) * 1.5;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (1.2 + seed * 2.2) * uPixelRatio * (40.0 / -mv.z);
          vAlpha = (0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * (0.5 + seed) + seed * 90.0))) *(1.0 - smoothstep(15.0, 90.0, -mv.z));
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = (1.0 - smoothstep(0.0, 0.5, d)) * vAlpha;
          gl_FragColor = vec4(vec3(0.45, 0.85, 1.0) * 1.4, a * 0.55);
        }`,
    });
    this.dust = new THREE.Points(geo, this.dustMat);
    this.dust.frustumCulled = false;
    this.group.add(this.dust);
  }

  update(time: number) {
    this.dustMat.uniforms.uTime.value = time;
  }
}
