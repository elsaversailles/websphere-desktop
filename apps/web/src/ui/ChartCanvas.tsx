import { useEffect, useRef } from 'react';
import { Chart, type ChartConfiguration } from 'chart.js/auto';

export function ChartCanvas({ config, height = 220 }: { config: ChartConfiguration; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    chartRef.current = new Chart(canvasRef.current, config);
    return () => chartRef.current?.destroy();
  }, [JSON.stringify(config)]);

  return <canvas ref={canvasRef} style={{ maxHeight: height }} />;
}
