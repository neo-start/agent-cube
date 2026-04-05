import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Grid, Stars, Float } from '@react-three/drei';
import * as THREE from 'three';
import { useAgentConfigs } from '../../hooks/useAgentConfigs.js';

function CenterPiece() {
  const { agentConfigs: AGENT_CONFIGS } = useAgentConfigs();
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = state.clock.elapsedTime * 0.5;
    }
  });

  return (
    <group position={[0, 0, 0]}>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.8, 1.2, 6]} />
        <meshBasicMaterial color="#1a3a5f" transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>

      <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
        <mesh ref={meshRef} position={[0, 1.2, 0]}>
          <octahedronGeometry args={[0.3, 0]} />
          <meshBasicMaterial color="#4d9fff" wireframe />
        </mesh>
      </Float>

      <pointLight position={[0, 1.5, 0]} color="#4d9fff" intensity={0.8} distance={4} />

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

function OfficeLighting({ dark }: { dark: boolean }) {
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

interface OfficeProps {
  dark: boolean;
}

export function OfficeEnvironment({ dark }: OfficeProps) {
  const bgColor = dark ? '#050810' : '#e8eeff';
  return (
    <>
      <color attach="background" args={[bgColor]} />
      <OfficeLighting dark={dark} />
      {dark && <Stars radius={60} depth={30} count={3000} factor={3} saturation={0} fade speed={0.5} />}

      {/* Office floor + grid */}
      <group>
        <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
          <planeGeometry args={[20, 20]} />
          <meshStandardMaterial color={dark ? '#080c14' : '#dde4f5'} roughness={0.9} metalness={0.05} />
        </mesh>
        <Grid
          position={[0, 0.001, 0]}
          args={[20, 20]}
          cellSize={1}
          cellThickness={0.3}
          cellColor={dark ? '#1a2035' : '#b8c4dc'}
          sectionSize={5}
          sectionThickness={0.5}
          sectionColor={dark ? '#1e3a5f' : '#8ca0c8'}
          fadeDistance={18}
          fadeStrength={1}
          infiniteGrid={false}
        />
        {/* Edge accent ring */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
          <ringGeometry args={[9.5, 10, 64]} />
          <meshBasicMaterial color={dark ? '#1a3a5f' : '#93c5fd'} transparent opacity={0.3} side={THREE.DoubleSide} />
        </mesh>
      </group>

      <CenterPiece />
    </>
  );
}
