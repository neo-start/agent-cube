import { Suspense, useState, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Stars, Float } from '@react-three/drei';
import * as THREE from 'three';
import { AgentDesk } from './AgentDesk';
import { IsometricOffice } from './IsometricOffice';
import { ChatModal } from './ChatModal';
import { AGENT_CONFIGS } from '../types';
import type { AgentData, AgentConfig } from '../types';

interface Props {
  agents: Record<string, AgentData>;
  onAssignTask?: (agent: AgentConfig) => void;
  darkMode?: boolean;
  onDeskClick?: (agentName: string) => void;
}

function Floor({ dark }: { dark: boolean }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <circleGeometry args={[10, 64]} />
        <meshStandardMaterial
          color={dark ? '#080c14' : '#dde4f5'}
          roughness={0.9}
          metalness={dark ? 0.1 : 0}
        />
      </mesh>

      <Grid
        position={[0, 0.001, 0]}
        args={[20, 20]}
        cellSize={1}
        cellThickness={0.3}
        cellColor={dark ? '#1a2035' : '#c8d0e8'}
        sectionSize={5}
        sectionThickness={0.5}
        sectionColor={dark ? '#1e3a5f' : '#94a3c8'}
        fadeDistance={10}
        fadeStrength={2}
        infiniteGrid={false}
      />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
        <ringGeometry args={[9.5, 10, 64]} />
        <meshBasicMaterial
          color={dark ? '#1a3a5f' : '#93c5fd'}
          transparent opacity={0.3} side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

function CenterPiece() {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = state.clock.elapsedTime * 0.5;
    }
  });

  return (
    <group position={[0, 0, 0]}>
      {/* Center platform */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.8, 1.2, 6]} />
        <meshBasicMaterial color="#1a3a5f" transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>

      {/* Rotating hologram */}
      <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
        <mesh ref={meshRef} position={[0, 1.2, 0]}>
          <octahedronGeometry args={[0.3, 0]} />
          <meshBasicMaterial color="#4d9fff" wireframe />
        </mesh>
      </Float>

      {/* Center glow */}
      <pointLight position={[0, 1.5, 0]} color="#4d9fff" intensity={0.8} distance={4} />

      {/* Connection lines to each agent (decorative floor markings) */}
      {AGENT_CONFIGS.map((agent, i) => (
        <mesh key={i} position={[agent.position[0] / 2, 0.005, agent.position[2] / 2]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.04, Math.sqrt(agent.position[0] ** 2 + agent.position[2] ** 2)]} />
          <meshBasicMaterial
            color={agent.color}
            transparent
            opacity={0.15}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

function SceneLighting({ dark }: { dark: boolean }) {
  return (
    <>
      <ambientLight intensity={dark ? 0.15 : 1.2} color={dark ? '#1a2035' : '#ffffff'} />
      <directionalLight
        position={[5, 10, 5]}
        intensity={dark ? 0.4 : 1.5}
        color={dark ? '#b4c8ff' : '#fffaf0'}
        castShadow
      />
      <pointLight position={[0, 8, 0]} color="#ffffff" intensity={dark ? 0.3 : 0.8} distance={20} />
    </>
  );
}

export function Scene({ agents, onAssignTask, darkMode = true, onDeskClick }: Props) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  const selectedConfig = selectedAgent ? AGENT_CONFIGS.find(a => a.name === selectedAgent) : null;

  const bgColor = darkMode ? '#050810' : '#e8eeff';

  return (
    <div style={{ width: '100vw', height: '100vh', background: bgColor }}>
      <Canvas
        camera={{ position: [0, 7, 9], fov: 45, near: 0.1, far: 100 }}
        shadows
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: darkMode ? 1.2 : 1.8 }}
      >
        <color attach="background" args={[bgColor]} />
        <Suspense fallback={null}>
          <SceneLighting dark={darkMode} />
          {darkMode && <Stars radius={60} depth={30} count={3000} factor={3} saturation={0} fade speed={0.5} />}
          <IsometricOffice dark={darkMode} />
          <Floor dark={darkMode} />
          <CenterPiece />

          {AGENT_CONFIGS.map((config) => (
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
