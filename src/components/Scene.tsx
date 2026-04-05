import { Suspense, useState, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { AgentDesk } from './AgentDesk.js';
import { ChatModal } from './ChatModal.js';
import { OfficeEnvironment } from './environments/OfficeEnvironment.js';
import { GrasslandEnvironment } from './environments/GrasslandEnvironment.js';
import { useAgentConfigs } from '../hooks/useAgentConfigs.js';
import type { AgentData, AgentConfig, SceneType } from '../types.js';

interface Props {
  agents: Record<string, AgentData>;
  onAssignTask?: (agent: AgentConfig) => void;
  darkMode?: boolean;
  onDeskClick?: (agentName: string) => void;
  sceneType?: SceneType;
}

/** Compute a semi-circle layout for grassland mode */
function getGrasslandPositions(count: number): [number, number, number][] {
  if (count === 0) return [];
  if (count === 1) return [[0, 0, 3]];
  const positions: [number, number, number][] = [];
  const startAngle = -Math.PI * 0.35;
  const endAngle = Math.PI * 0.35;
  const radius = 5;
  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 0.5;
    const angle = startAngle + (endAngle - startAngle) * t;
    positions.push([
      Math.sin(angle) * radius,
      0,
      Math.cos(angle) * radius - 0.5,
    ]);
  }
  return positions;
}

export function Scene({ agents, onAssignTask, darkMode = true, onDeskClick, sceneType = 'office' }: Props) {
  void onAssignTask;
  const { agentConfigs: AGENT_CONFIGS } = useAgentConfigs();
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  const selectedConfig = selectedAgent ? AGENT_CONFIGS.find(a => a.name === selectedAgent) : null;

  const isGrassland = sceneType === 'grassland';

  // Compute per-scene agent configs (override positions for grassland)
  const sceneAgentConfigs = useMemo(() => {
    if (!isGrassland) return AGENT_CONFIGS;
    const grassPositions = getGrasslandPositions(AGENT_CONFIGS.length);
    return AGENT_CONFIGS.map((config, i) => ({
      ...config,
      position: grassPositions[i] || config.position,
    }));
  }, [AGENT_CONFIGS, isGrassland]);

  return (
    <div style={{ width: '100vw', height: '100vh', background: isGrassland ? '#87b5d4' : (darkMode ? '#050810' : '#e8eeff') }}>
      <Canvas
        camera={{ position: [0, 7, 9], fov: 45, near: 0.1, far: 100 }}
        shadows
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: isGrassland ? 1.3 : (darkMode ? 1.2 : 1.8),
        }}
      >
        <Suspense fallback={null}>
          {/* Environment */}
          {isGrassland ? (
            <GrasslandEnvironment />
          ) : (
            <OfficeEnvironment dark={darkMode} />
          )}

          {/* Agents */}
          {sceneAgentConfigs.map((config) => (
            <AgentDesk
              key={config.name}
              config={config}
              data={agents[config.name] || { status: 'idle', taskId: null, description: null, latestLog: null, title: null, by: null, raw: null, delegatedBy: null, parentTaskId: null, source: null }}
              onClick={() => {
                if (onDeskClick) {
                  onDeskClick(config.name);
                } else {
                  setSelectedAgent(config.name);
                }
              }}
              dark={darkMode}
              sceneType={sceneType}
            />
          ))}

          <OrbitControls
            enablePan={true}
            enableZoom={true}
            enableRotate={true}
            minDistance={6}
            maxDistance={25}
            minPolarAngle={Math.PI / 8}
            maxPolarAngle={Math.PI / 2.2}
            target={[0, 1, 0]}
          />
        </Suspense>
      </Canvas>

      {selectedConfig && (
        <ChatModal
          agent={selectedConfig}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </div>
  );
}
