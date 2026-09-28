import * as THREE from 'three';

export const EYE_HEIGHT = 1.7;
const SWIM_DEPTH = 1.25;

const _v = new THREE.Vector3();
const _right = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();

// First person movement on a sphere. Everything is in the planet's local
// (rotating) frame. `heading` is kept on the tangent plane and re-projected
// every frame, which avoids the pole problems a yaw angle would have.
export class Walker {
  constructor() {
    this.frame = null;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = new THREE.Vector3(1, 0, 0);
    this.pitch = 0;
    this.grounded = false;
    this.swimming = false;
    this.onLava = false;
    this.jetFuel = 1;
    this.jetting = false;
    this.airTime = 0;
    this.stamina = 1;
    this.bobPhase = 0;
    this.bob = 0;
    this.moving = 0;
    this.speed = 0;
    this.stats = { walk: 5.2, sprint: 9.5, jump: 5.4, jetAccel: 17, jetTime: 2.4, gravity: 9.0 };
    this.events = [];
  }

  up(out = new THREE.Vector3()) {
    return out.copy(this.pos).normalize();
  }

  place(planet, dir, heading) {
    this.frame = planet;
    const floor = this.floorAt(dir);
    this.pos.copy(dir).multiplyScalar(floor + 0.05);
    this.vel.set(0, 0, 0);
    if (heading) this.heading.copy(heading);
    this.heading.projectOnPlane(dir).normalize();
    if (this.heading.lengthSq() < 0.1) this.heading.set(1, 0, 0).projectOnPlane(dir).normalize();
    this.pitch = 0;
    this.grounded = true;
  }

  floorAt(dir) {
    const p = this.frame;
    const h = p.heightAt(dir);
    this.swimming = false;
    this.onLava = false;
    if (p.seaLevel !== null) {
      const mode = p.def.ocean.mode;
      if (mode === 'ice') return p.radius + Math.max(h, 0);
      if (mode === 'lava' && h < 0) {
        this.onLava = true;
        return p.radius;
      }
      if (h < -SWIM_DEPTH) {
        this.swimming = true;
        return p.radius - SWIM_DEPTH;
      }
    }
    return p.radius + h;
  }

  update(dt, input, ctx) {
    const up = this.up(_v);
    const look = input.enabled ? input.look() : { x: 0, y: 0 };
    this.heading.applyAxisAngle(up, -look.x);
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - look.y));
    this.heading.addScaledVector(up, -this.heading.dot(up)).normalize();
    _right.crossVectors(this.heading, up);

    const f = input.axis('KeyS', 'KeyW');
    const s = input.axis('KeyA', 'KeyD');
    const wish = new THREE.Vector3().addScaledVector(this.heading, f).addScaledVector(_right, s);
    if (wish.lengthSq() > 1) wish.normalize();
    const sprinting = (input.key('ShiftLeft') || input.key('ShiftRight')) && f > 0 && this.stamina > 0.05 && !this.swimming;
    const st = this.stats;
    let speed = this.swimming ? 3.2 : sprinting ? st.sprint : st.walk;
    speed *= ctx.speedScale || 1;
    if (sprinting && this.moving > 0.1) this.stamina = Math.max(0, this.stamina - dt * 0.12);
    else this.stamina = Math.min(1, this.stamina + dt * 0.2);

    let vr = this.vel.dot(up);
    const vt = this.vel.clone().addScaledVector(up, -vr);
    const target = wish.multiplyScalar(speed);
    if (this.grounded || this.swimming) {
      const accel = 42 * dt;
      const diff = target.clone().sub(vt);
      if (diff.length() > accel) diff.setLength(accel);
      vt.add(diff);
    } else {
      vt.lerp(target, Math.min(1, dt * 1.6));
    }

    vr -= st.gravity * dt;
    if (input.hit('Space') && this.grounded && !this.swimming) {
      vr = st.jump;
      this.grounded = false;
      this.events.push({ type: 'jump' });
    }
    this.jetting = false;
    if (!this.grounded) this.airTime += dt;
    if (input.key('Space') && !this.grounded && !this.swimming && this.airTime > 0.18 && this.jetFuel > 0) {
      this.jetting = true;
      vr += st.jetAccel * dt;
      if (vr > 9) vr = 9;
      vt.addScaledVector(this.heading, 5 * dt);
      this.jetFuel = Math.max(0, this.jetFuel - dt / st.jetTime);
    }
    if (this.grounded) this.jetFuel = Math.min(1, this.jetFuel + dt * 0.55);

    this.vel.copy(vt).addScaledVector(up, vr);
    this.pos.addScaledVector(this.vel, dt);

    // obstacles (tree trunks, boulders) as vertical cylinders
    if (ctx.colliders) {
      for (const c of ctx.colliders) {
        const d = _v.subVectors(this.pos, c.pos);
        const u = this.up(new THREE.Vector3());
        const vert = d.dot(u);
        if (vert < -0.5 || vert > c.height) continue;
        d.addScaledVector(u, -vert);
        const dist = d.length();
        const min = c.radius + 0.35;
        if (dist < min && dist > 1e-4) {
          this.pos.addScaledVector(d, (min - dist) / dist);
          const into = this.vel.dot(d) / dist;
          if (into < 0) this.vel.addScaledVector(d, -into / dist);
        }
      }
    }

    // ground
    const r = this.pos.length();
    const dir = up.copy(this.pos).divideScalar(r);
    const floor = this.floorAt(dir);
    const wasGrounded = this.grounded;
    vr = this.vel.dot(dir);
    if (r <= floor) {
      this.pos.copy(dir).multiplyScalar(floor);
      if (vr < 0) {
        if (vr < -12) this.events.push({ type: 'hardLanding', speed: -vr });
        this.vel.addScaledVector(dir, -vr);
      }
      this.grounded = true;
    } else if (wasGrounded && r - floor < 0.45 && vr < 1.0) {
      // stick to the ground when walking down slopes
      this.pos.copy(dir).multiplyScalar(floor);
      this.vel.addScaledVector(dir, -vr);
      this.grounded = true;
    } else {
      this.grounded = false;
    }
    if (this.grounded) this.airTime = 0;

    const hs = vt.length();
    this.speed = hs;
    this.moving += ((this.grounded && hs > 0.5 ? 1 : 0) - this.moving) * Math.min(1, dt * 8);
    this.bobPhase += dt * hs * 1.8;
    this.bob = Math.sin(this.bobPhase) * 0.045 * this.moving * (sprinting ? 1.4 : 1);
    this.sprinting = sprinting;
  }

  eye(out = new THREE.Vector3()) {
    const up = this.up(_v);
    return out.copy(this.pos).addScaledVector(up, EYE_HEIGHT + this.bob);
  }

  viewQuat(out = new THREE.Quaternion()) {
    const up = this.up(_v);
    _right.crossVectors(this.heading, up);
    // basis with -Z along heading, +Y along up
    _m.makeBasis(_right, up, this.heading.clone().negate());
    out.setFromRotationMatrix(_m);
    out.multiply(_q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.pitch));
    return out;
  }

  lookDir(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(this.viewQuat());
  }
}
