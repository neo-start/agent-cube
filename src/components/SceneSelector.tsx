import { useState } from 'react';
import type { SceneType } from '../types.js';

interface Props {
  current: SceneType;
  onChange: (scene: SceneType) => void;
}

const SCENES: { type: SceneType; label: string; icon: JSX.Element }[] = [
  {
    type: 'office',
    label: 'Office',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="4" width="12" height="10" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <path d="M4 4V2.5A1.5 1.5 0 015.5 1h5A1.5 1.5 0 0112 2.5V4" stroke="currentColor" strokeWidth="1.5" />
        <rect x="5" y="7" width="6" height="4" rx="0.5" stroke="currentColor" strokeWidth="1" fill="none" />
      </svg>
    ),
  },
  {
    type: 'grassland',
    label: 'Grassland',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M1 14c2-3 3-8 4-8s1 5 2 5 1.5-6 3-6 2 4 3 4 1.5-3 2-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="12" cy="3" r="2" stroke="currentColor" strokeWidth="1.2" fill="none" />
      </svg>
    ),
  },
];

export function SceneSelector({ current, onChange }: Props) {
  const [hoveredScene, setHoveredScene] = useState<SceneType | null>(null);
  const [transitioning, setTransitioning] = useState(false);

  const handleChange = (scene: SceneType) => {
    if (scene === current || transitioning) return;
    setTransitioning(true);
    // Small delay to let fade overlay show
    setTimeout(() => {
      onChange(scene);
      setTimeout(() => setTransitioning(false), 300);
    }, 200);
  };

  return (
    <>
      {/* Fade overlay for transition */}
      {transitioning && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: '#000',
          zIndex: 9999,
          animation: 'sceneFade 500ms ease-in-out',
          pointerEvents: 'none',
        }} />
      )}

      {/* Scene selector pills */}
      <div style={{
        display: 'flex',
        gap: 4,
        background: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(8px)',
        borderRadius: 10,
        padding: 3,
        border: '1px solid rgba(255, 255, 255, 0.1)',
      }}>
        {SCENES.map(scene => {
          const isActive = scene.type === current;
          const isHovered = scene.type === hoveredScene;
          return (
            <button
              key={scene.type}
              onClick={() => handleChange(scene.type)}
              onMouseEnter={() => setHoveredScene(scene.type)}
              onMouseLeave={() => setHoveredScene(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '5px 10px',
                borderRadius: 8,
                border: 'none',
                cursor: transitioning ? 'default' : 'pointer',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: 0.5,
                color: isActive ? '#fff' : 'rgba(255,255,255,0.5)',
                background: isActive
                  ? 'rgba(77, 159, 255, 0.3)'
                  : isHovered
                    ? 'rgba(255, 255, 255, 0.08)'
                    : 'transparent',
                transition: 'all 0.2s',
              }}
            >
              {scene.icon}
              {scene.label}
            </button>
          );
        })}
      </div>

      <style>{`
        @keyframes sceneFade {
          0% { opacity: 0; }
          40% { opacity: 1; }
          60% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
    </>
  );
}
