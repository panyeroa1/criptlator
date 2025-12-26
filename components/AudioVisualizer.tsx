import React, { useRef, useEffect, memo } from 'react';

interface AudioVisualizerProps {
  analyser: AnalyserNode | null;
  color: string;
  width?: number;
  height?: number;
  mode?: 'bottom' | 'center' | 'radial';
}

/**
 * AudioVisualizer component optimized for high-performance rendering.
 * Uses optimized 2D context with frequency data smoothing.
 */
const AudioVisualizer: React.FC<AudioVisualizerProps> = memo(({ analyser, color, width = 140, height = 24, mode = 'bottom' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!analyser || !canvasRef.current) return;

    const canvas = canvasRef.current;
    let animationId: number;
    
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const smoothedArray = new Float32Array(bufferLength);
    const alpha = 0.25; // Smoothing factor for fluid motion

    const draw = () => {
      animationId = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const barCount = mode === 'radial' ? 60 : 30; 
      const barWidth = (canvas.width / barCount);
      
      ctx.shadowBlur = mode === 'radial' ? 12 : 8;
      ctx.shadowColor = color;
      ctx.fillStyle = color;

      if (mode === 'radial') {
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const radius = Math.min(centerX, centerY) * 0.8;
        
        for (let i = 0; i < barCount; i++) {
          const dataIndex = Math.floor((i / barCount) * (bufferLength / 2));
          smoothedArray[i] = (alpha * dataArray[dataIndex]) + ((1 - alpha) * smoothedArray[i]);
          
          const amplitude = (smoothedArray[i] / 255);
          const barLength = amplitude * (radius * 0.5);
          const angle = (i / barCount) * Math.PI * 2;
          
          const x1 = centerX + Math.cos(angle) * radius;
          const y1 = centerY + Math.sin(angle) * radius;
          const x2 = centerX + Math.cos(angle) * (radius + barLength);
          const y2 = centerY + Math.sin(angle) * (radius + barLength);
          
          ctx.beginPath();
          ctx.lineWidth = 2;
          ctx.lineCap = 'round';
          ctx.strokeStyle = color;
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      } else {
        let x = 0;
        for (let i = 0; i < barCount; i++) {
          const dataIndex = Math.floor((i / barCount) * (bufferLength / 2));
          smoothedArray[i] = (alpha * dataArray[dataIndex]) + ((1 - alpha) * smoothedArray[i]);
          const barHeight = (smoothedArray[i] / 255) * canvas.height;
          
          if (mode === 'center') {
            ctx.fillRect(x, (canvas.height / 2) - (barHeight / 2), barWidth - 2, barHeight);
          } else {
            ctx.fillRect(x, canvas.height - barHeight, barWidth - 2, barHeight);
          }
          x += barWidth;
        }
      }
    };

    draw();

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [analyser, color, width, height, mode]);

  return (
    <canvas 
      ref={canvasRef} 
      width={width} 
      height={height} 
      className="opacity-80 transition-all duration-300 pointer-events-none"
      style={{ imageRendering: 'auto' }} 
    />
  );
});

AudioVisualizer.displayName = 'AudioVisualizer';

export default AudioVisualizer;