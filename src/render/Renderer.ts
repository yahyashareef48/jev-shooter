import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  BloomEffect,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { CAMERA, COLORS } from '../core/config';

/** Owns the WebGL renderer, scene, camera and the post-processing stack. */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private chroma: ChromaticAberrationEffect;
  private vignette: VignetteEffect;
  private hurt = 0;

  constructor(container: HTMLElement) {
    // postprocessing handles AA via multisampling and tone mapping via ToneMappingEffect.
    this.renderer = new THREE.WebGLRenderer({
      powerPreference: 'high-performance',
      antialias: false,
      stencil: false,
      depth: true,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.toneMapping = THREE.NoToneMapping;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, innerWidth / innerHeight, 0.1, 400);
    this.camera.layers.enable(1); // overlay-ish objects the floor reflection should not render
    this.scene.fog = new THREE.FogExp2(COLORS.fog, 0.012);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();

    this.composer = new EffectComposer(this.renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: Math.min(4, this.renderer.capabilities.maxSamples),
    });
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    const bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: 0.75,
      luminanceSmoothing: 0.25,
      intensity: 1.35,
      radius: 0.72,
    });
    this.vignette = new VignetteEffect({ offset: 0.28, darkness: 0.62 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.composer.addPass(new EffectPass(this.camera, bloom, this.vignette, tone));

    this.chroma = new ChromaticAberrationEffect({
      offset: new THREE.Vector2(0, 0),
      radialModulation: true,
      modulationOffset: 0.25,
    });
    this.composer.addPass(new EffectPass(this.camera, this.chroma));

    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
  }

  /** Kick the damage feedback (chromatic split + darker vignette). */
  flashHurt(amount = 1) {
    this.hurt = Math.min(1.5, this.hurt + amount);
  }

  render(dt: number) {
    this.hurt = Math.max(0, this.hurt - dt * 2.5);
    const o = this.hurt * 0.0032;
    this.chroma.offset.set(o, o * 0.6);
    this.vignette.darkness = 0.62 + this.hurt * 0.25;
    this.composer.render(dt);
  }
}
