export interface CaptureGeometry {
  /** 録画対象ディスプレイの原点（クリック座標と同一空間） */
  displayOriginX: number;
  displayOriginY: number;
  /** 録画対象ディスプレイのサイズ（クリック座標と同一空間） */
  displayWidth: number;
  displayHeight: number;
  /** 録画された映像ストリームのピクセルサイズ */
  videoWidth: number;
  videoHeight: number;
}

export function osToVideoCoords(
  osX: number,
  osY: number,
  g: CaptureGeometry,
): { x: number; y: number } {
  const relX = osX - g.displayOriginX;
  const relY = osY - g.displayOriginY;
  return {
    x: relX * (g.videoWidth / g.displayWidth),
    y: relY * (g.videoHeight / g.displayHeight),
  };
}

export function isWithinDisplay(osX: number, osY: number, g: CaptureGeometry): boolean {
  return (
    osX >= g.displayOriginX &&
    osX < g.displayOriginX + g.displayWidth &&
    osY >= g.displayOriginY &&
    osY < g.displayOriginY + g.displayHeight
  );
}
