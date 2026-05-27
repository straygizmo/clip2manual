import { useEffect, useRef, type RefObject } from 'react';
import { type ClickEvent } from '../../shared/types';
import { clicksCrossed, rippleProgress, RIPPLE_MAX_RADIUS_RATIO } from './rippleOverlay';

interface Props {
  videoRef: RefObject<HTMLVideoElement>;
  clicks: ClickEvent[];
}

interface ActiveRipple { x: number; y: number; firedAt: number; }

/**
 * 映像に重ねた canvas に、クリック位置のリップル（広がって消える輪＋中心点）を描く。
 * canvas のピクセルバッファを映像実解像度にし CSS で同矩形に伸縮するため、映像ピクセル座標のまま描ける。
 * video.currentTime をキーにするので元音声/TTS 両モードで動作する。
 */
export function RippleCanvas({ videoRef, clicks }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // clicks を最新参照で使う（rAF ループは一度だけ張る）
  const clicksRef = useRef(clicks);
  clicksRef.current = clicks;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let prevT = videoRef.current?.currentTime ?? 0;
    const active: ActiveRipple[] = [];

    const loop = () => {
      const video = videoRef.current;
      if (video && video.videoWidth > 0) {
        if (canvas.width !== video.videoWidth) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        const w = canvas.width;
        const t = video.currentTime;
        const dt = t - prevT;
        // 後方シーク or 大きな前方ジャンプ（シーク/初回フレーム/TTSのセグメント境界）はリセットし、
        // 通常の前進フレームでのみ交差したクリックを発火する（前方シークで大量に発火しないように）。
        if (dt < -0.05 || dt > 1.5) {
          active.length = 0;
        } else if (dt > 0) {
          for (const c of clicksCrossed(clicksRef.current, prevT, t)) {
            active.push({ x: c.x, y: c.y, firedAt: performance.now() });
          }
        }
        prevT = t;

        ctx.clearRect(0, 0, w, canvas.height);
        const maxR = w * RIPPLE_MAX_RADIUS_RATIO;
        const now = performance.now();
        for (let i = active.length - 1; i >= 0; i--) {
          const p = rippleProgress((now - active[i].firedAt) / 1000);
          if (!p) { active.splice(i, 1); continue; }
          ctx.save();
          ctx.globalAlpha = p.alpha;
          ctx.strokeStyle = '#ffcf33';
          ctx.lineWidth = Math.max(2, w / 400);
          ctx.beginPath();
          ctx.arc(active[i].x, active[i].y, Math.max(2, p.radius01 * maxR), 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#ff5470';
          ctx.beginPath();
          ctx.arc(active[i].x, active[i].y, Math.max(3, w / 320), 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [videoRef]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 size-full pointer-events-none"
    />
  );
}
