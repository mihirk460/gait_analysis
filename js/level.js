// Auto-leveling: reads the phone's gravity vector and reports how far the camera is
// rolled (crooked horizon) and pitched (pointing up/down). The roll is used to rotate
// detected landmarks back to true vertical before any angle is computed.
import { deg } from './geometry.js';

/**
 * Pure math, testable without a browser.
 * gx, gy, gz: accelerationIncludingGravity in the DEVICE frame (x right, y up, z out of screen).
 * screenAngle: screen.orientation.angle (0, 90, 180, 270).
 * sign: +1 if the platform reports the gravity vector pointing DOWN (iOS), -1 if UP (W3C spec / Android).
 * Returns { roll, pitch } in degrees. roll > 0 = phone rotated clockwise as seen by the user.
 * pitch > 0 = rear camera pointing upward.
 */
export function computeTilt(gx, gy, gz, screenAngle = 0, sign = 1) {
  const a = (screenAngle * Math.PI) / 180;
  // rotate device axes into the current screen frame
  const sx = gx * Math.cos(a) - gy * Math.sin(a);
  const sy = gx * Math.sin(a) + gy * Math.cos(a);
  const x = sign * sx, y = sign * sy, z = sign * gz;
  const roll = deg(Math.atan2(x, -y));
  const pitch = deg(Math.atan2(z, Math.hypot(x, y)));
  return { roll, pitch };
}

export class LevelSensor {
  constructor({ smoothing = 0.15 } = {}) {
    this.roll = 0;
    this.pitch = 0;
    this.available = false;
    this.sign = null; // decided from the first upright sample
    this.smoothing = smoothing;
    this._onMotion = this._onMotion.bind(this);
  }

  /** Must be called from a user gesture on iOS. Resolves true if motion data is available. */
  async start() {
    if (typeof window === 'undefined' || typeof DeviceMotionEvent === 'undefined') return false;
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const res = await DeviceMotionEvent.requestPermission();
        if (res !== 'granted') return false;
      } catch {
        return false;
      }
    }
    window.addEventListener('devicemotion', this._onMotion);
    return true;
  }

  stop() {
    if (typeof window !== 'undefined') window.removeEventListener('devicemotion', this._onMotion);
  }

  static screenAngle() {
    if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.angle === 'number') {
      return screen.orientation.angle;
    }
    if (typeof window !== 'undefined' && typeof window.orientation === 'number') return (window.orientation + 360) % 360;
    return 0;
  }

  _onMotion(e) {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null || g.y == null || g.z == null) return;
    if (this.sign === null) {
      // Phone is expected to be held roughly upright when starting: gravity mostly along screen-y.
      const a = (LevelSensor.screenAngle() * Math.PI) / 180;
      const sy = g.x * Math.sin(a) + g.y * Math.cos(a);
      if (Math.abs(sy) < 5) return; // not upright yet, wait for a usable sample
      this.sign = sy < 0 ? 1 : -1;
    }
    const { roll, pitch } = computeTilt(g.x, g.y, g.z, LevelSensor.screenAngle(), this.sign);
    const k = this.available ? this.smoothing : 1;
    this.roll += k * (roll - this.roll);
    this.pitch += k * (pitch - this.pitch);
    this.available = true;
  }
}
