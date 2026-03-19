import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import type { AgentConfig, AgentData } from '../types';

interface Props {
  config: AgentConfig;
  data: AgentData;
  onClick: () => void;
  dark?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  idle: '#6b7280',
  pending: '#a78bfa',
  working: '#22c55e',
  done: '#eab308',
  blocked: '#ef4444',
};

function AgentCharacter({ color, accentColor, status, isHovered }: { color: string; accentColor: string; status: string; isHovered: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (!groupRef.current) return;
    const t = state.clock.elapsedTime;

    // Idle bobbing
    groupRef.current.position.y = Math.sin(t * 1.5) * 0.03 + (isHovered ? 0.1 : 0);

    // Working: faster animation
    if (status === 'working') {
      groupRef.current.rotation.y = Math.sin(t * 2) * 0.15;
    } else {
      groupRef.current.rotation.y += (0 - groupRef.current.rotation.y) * 0.05;
    }

    // Head tilt
    if (headRef.current) {
      headRef.current.rotation.z = Math.sin(t * 0.8) * 0.05;
    }

    // Glow pulse
    if (glowRef.current) {
      const mat = glowRef.current.material as THREE.MeshBasicMaterial;
      if (status === 'working') {
        mat.opacity = 0.15 + Math.sin(t * 3) * 0.08;
      } else if (status === 'idle') {
        mat.opacity = 0.05 + Math.sin(t * 1) * 0.03;
      } else {
        mat.opacity = 0.1;
      }
    }
  });

  const statusColor = STATUS_COLORS[status] || '#6b7280';

  return (
    <group ref={groupRef} position={[0, 1.2, 0]}>
      {/* Glow sphere */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.35, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.08} />
      </mesh>

      {/* Body */}
      <mesh position={[0, -0.05, 0]}>
        <cylinderGeometry args={[0.13, 0.16, 0.35, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} roughness={0.4} metalness={0.6} />
      </mesh>

      {/* Neck */}
      <mesh position={[0, 0.16, 0]}>
        <cylinderGeometry args={[0.06, 0.07, 0.08, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.2} roughness={0.4} metalness={0.6} />
      </mesh>

      {/* Head */}
      <mesh ref={headRef} position={[0, 0.29, 0]}>
        <boxGeometry args={[0.22, 0.22, 0.22]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} roughness={0.3} metalness={0.7} />
      </mesh>

      {/* Eyes */}
      <mesh position={[-0.06, 0.31, 0.112]}>
        <sphereGeometry args={[0.025, 8, 8]} />
        <meshBasicMaterial color={accentColor} />
      </mesh>
      <mesh position={[0.06, 0.31, 0.112]}>
        <sphereGeometry args={[0.025, 8, 8]} />
        <meshBasicMaterial color={accentColor} />
      </mesh>

      {/* Status indicator on chest */}
      <mesh position={[0, -0.02, 0.15]}>
        <sphereGeometry args={[0.03, 8, 8]} />
        <meshBasicMaterial color={statusColor} />
      </mesh>
    </group>
  );
}

function Monitor({ color, accentColor, hasTask, frameColor, standColor, screenOff }: { color: string; accentColor: string; hasTask: boolean; frameColor: string; standColor: string; screenOff: string }) {
  const screenRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (!screenRef.current || !hasTask) return;
    const mat = screenRef.current.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.7 + Math.sin(state.clock.elapsedTime * 2) * 0.15;
  });

  return (
    <group position={[0, 1.0, -0.2]}>
      {/* Monitor stand */}
      <mesh position={[0, -0.25, 0]}>
        <cylinderGeometry args={[0.04, 0.06, 0.2, 8]} />
        <meshStandardMaterial color={standColor} roughness={0.8} metalness={0.3} />
      </mesh>
      <mesh position={[0, -0.32, 0]}>
        <cylinderGeometry args={[0.1, 0.12, 0.04, 8]} />
        <meshStandardMaterial color={standColor} roughness={0.8} metalness={0.3} />
      </mesh>

      {/* Monitor frame */}
      <mesh>
        <boxGeometry args={[0.55, 0.38, 0.04]} />
        <meshStandardMaterial color={frameColor} roughness={0.6} metalness={0.4} />
      </mesh>

      {/* Screen */}
      <mesh ref={screenRef} position={[0, 0, 0.022]}>
        <planeGeometry args={[0.48, 0.31]} />
        <meshBasicMaterial color={hasTask ? color : screenOff} transparent opacity={hasTask ? 0.7 : 1} />
      </mesh>

      {/* Screen glow */}
      {hasTask && (
        <mesh position={[0, 0, 0.025]}>
          <planeGeometry args={[0.48, 0.31]} />
          <meshBasicMaterial color={accentColor} transparent opacity={0.05} />
        </mesh>
      )}
    </group>
  );
}

export function AgentDesk({ config, data, onClick, dark = true }: Props) {
  const deskColor    = dark ? '#1e2433' : '#dce4f5';
  const legColor     = dark ? '#111827' : '#94a3b8';
  const keyboardColor = dark ? '#0f1117' : '#c8d0e8';
  const monitorFrame = dark ? '#111827' : '#b8c4dc';
  const monitorStand = dark ? '#1f2937' : '#94a3b8';
  const screenOff    = dark ? '#0a0a0f' : '#e2e8f5';
  const [hovered, setHovered] = useState(false);
  const deskRef = useRef<THREE.Group>(null);
  const statusLightRef = useRef<THREE.Mesh>(null);
  const auraRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;

    if (statusLightRef.current) {
      const mat = statusLightRef.current.material as THREE.MeshBasicMaterial;
      if (data.status === 'working') {
        mat.opacity = 0.6 + Math.sin(t * 4) * 0.4;
      } else if (data.status === 'blocked') {
        mat.opacity = 0.6 + Math.sin(t * 8) * 0.4;
      } else if (data.status === 'done') {
        mat.opacity = 0.8;
      } else {
        mat.opacity = 0.3;
      }
    }

    if (auraRef.current) {
      const mat = auraRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = hovered ? 0.12 + Math.sin(t * 2) * 0.04 : 0;
    }

    if (deskRef.current) {
      // Hover lift
      const targetY = hovered ? 0.05 : 0;
      deskRef.current.position.y += (targetY - deskRef.current.position.y) * 0.1;
    }
  });

  const statusColor = STATUS_COLORS[data.status] || '#6b7280';
  const hasTask = data.taskId !== null;

  return (
    <group
      ref={deskRef}
      position={config.position}
      onClick={onClick}
      onPointerEnter={() => { setHovered(true); document.body.style.cursor = 'pointer'; }}
      onPointerLeave={() => { setHovered(false); document.body.style.cursor = 'auto'; }}
    >
      {/* Hover aura */}
      <mesh ref={auraRef} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.4, 32]} />
        <meshBasicMaterial color={config.color} transparent opacity={0} side={THREE.DoubleSide} />
      </mesh>

      {/* Floor glow ring */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.1, 1.3, 32]} />
        <meshBasicMaterial color={config.color} transparent opacity={0.08} side={THREE.DoubleSide} />
      </mesh>

      {/* Desk surface */}
      <RoundedBox args={[1.8, 0.08, 1.2]} radius={0.02} position={[0, 0.76, 0]}>
        <meshStandardMaterial
          color={deskColor}
          roughness={0.3}
          metalness={dark ? 0.4 : 0.1}
          emissive={config.color}
          emissiveIntensity={hovered ? 0.06 : 0.02}
        />
      </RoundedBox>

      {/* Desk edge glow */}
      <mesh position={[0, 0.8, 0]}>
        <boxGeometry args={[1.82, 0.02, 1.22]} />
        <meshBasicMaterial color={config.accentColor} transparent opacity={0.15} />
      </mesh>

      {/* Desk legs */}
      {[[-0.8, -0.5], [0.8, -0.5], [-0.8, 0.5], [0.8, 0.5]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.38, z]}>
          <cylinderGeometry args={[0.04, 0.04, 0.72, 6]} />
          <meshStandardMaterial color={legColor} roughness={0.8} metalness={0.5} />
        </mesh>
      ))}

      {/* Monitor */}
      <Monitor color={config.color} accentColor={config.accentColor} hasTask={hasTask} frameColor={monitorFrame} standColor={monitorStand} screenOff={screenOff} />

      {/* Keyboard */}
      <mesh position={[0, 0.81, 0.2]}>
        <boxGeometry args={[0.5, 0.018, 0.18]} />
        <meshStandardMaterial color={keyboardColor} roughness={0.9} metalness={0.1} />
      </mesh>

      {/* Status light (on desk) */}
      <mesh ref={statusLightRef} position={[0.7, 0.82, -0.45]}>
        <sphereGeometry args={[0.04, 8, 8]} />
        <meshBasicMaterial color={statusColor} transparent opacity={0.8} />
      </mesh>
      {/* Status light bloom */}
      <pointLight position={[0.7, 0.9, -0.45]} color={statusColor} intensity={data.status !== 'idle' ? 0.5 : 0.1} distance={1.5} />

      {/* Agent character (on chair) */}
      <group position={[0, 0, 0.9]}>
        <AgentCharacter
          color={config.color}
          accentColor={config.accentColor}
          status={data.status}
          isHovered={hovered}
        />
      </group>

      {/* Floating name tag */}
      <Text
        position={[0, 2.5, 0.9]}
        fontSize={0.2}
        color={config.accentColor}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.005}
        outlineColor="#000000"
      >
        {config.name}
      </Text>
      <Text
        position={[0, 2.25, 0.9]}
        fontSize={0.1}
        color="#6b7280"
        anchorX="center"
        anchorY="middle"
      >
        {config.role}
      </Text>

      {/* Task status badge */}
      {hasTask && (
        <Text
          position={[0, 2.0, 0.9]}
          fontSize={0.09}
          color={statusColor}
          anchorX="center"
          anchorY="middle"
        >
          {data.status === 'working' ? '● Working' : data.status === 'done' ? '✓ Done' : data.status === 'blocked' ? '✗ Blocked' : '○ Idle'}
        </Text>
      )}

      {/* Task title preview above monitor */}
      {data.title && (
        <Text
          position={[0, 1.55, -0.18]}
          fontSize={0.07}
          color={config.accentColor}
          anchorX="center"
          anchorY="middle"
          maxWidth={1.4}
        >
          {data.title.length > 40 ? data.title.slice(0, 40) + '…' : data.title}
        </Text>
      )}

      {/* Agent color accent light */}
      <pointLight
        position={[0, 1.5, 0]}
        color={config.color}
        intensity={hovered ? 1.2 : 0.4}
        distance={3}
      />
    </group>
  );
}
