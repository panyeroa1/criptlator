
import React, { useRef, useEffect, memo } from 'react';

interface AudioVisualizerProps {
  analyser: AnalyserNode | null;
  color: string;
  width?: number;
  height?: number;
}

/**
 * AudioVisualizer component optimized for performance.
 * Implements exponential smoothing for fluid motion.
 */
const AudioVisualizer: React.FC<AudioVisualizerProps> = memo(({ analyser, color, width = 120, height = 40 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!analyser || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    // Reuse data arrays to avoid garbage collection pressure
    const dataArray = new Uint8Array(bufferLength);
    const smoothedArray = new Float32Array(bufferLength);
    
    /**
     * Smoothing factor (alpha). 
     * Lower values = smoother/slower movement.
     * Higher values = more responsive/jittery movement.
     */
    const alpha = 0.18; 
    
    let animationId: number;

    const draw = () => {
      animationId = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      // Clear the canvas efficiently
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const barWidth = (canvas.width / bufferLength) * 2.5;
      let x = 0;

      // Batch drawing: set style once and use a single path for all bars
      ctx.fillStyle = color;
      ctx.beginPath();

      for (let i = 0; i < bufferLength; i++) {
        // Apply exponential smoothing: smoothed = alpha * current + (1 - alpha) * previous
        smoothedArray[i] = (alpha * dataArray[i]) + ((1 - alpha) * smoothedArray[i]);
        
        const barHeight = (smoothedArray[i] / 255) * canvas.height;
        
        if (ctx.roundRect) {
          ctx.roundRect(x, canvas.height - barHeight, barWidth - 1, barHeight, 2);
        } else {
          ctx.rect(x, canvas.height - barHeight, barWidth - 1, barHeight);
        }

        x += barWidth + 1;
      }
      
      // Execute the fill operation once for all bars
      ctx.fill();
    };

    draw();

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [analyser, color, width, height]);

  return (
    <canvas 
      ref={canvasRef} 
      width={width} 
      height={height} 
      className="rounded-lg opacity-80"
      style={{ imageRendering: 'pixelated' }} 
    />
  );
});

AudioVisualizer.displayName = 'AudioVisualizer';

export default AudioVisualizer;
