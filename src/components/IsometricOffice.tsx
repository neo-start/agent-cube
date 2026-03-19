import { Grid } from '@react-three/drei';

export function IsometricOffice({ dark = true }: { dark?: boolean }) {
  const floorColor = dark ? '#080c14' : '#dde4f5';
  const gridCell   = dark ? '#1a2035' : '#b8c4dc';
  const gridSection = dark ? '#1e3a5f' : '#8ca0c8';

  return (
    <group>
      {/* Floor */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color={floorColor} roughness={0.9} metalness={0.05} />
      </mesh>

      {/* Grid overlay */}
      <Grid
        position={[0, 0.001, 0]}
        args={[20, 20]}
        cellSize={1}
        cellThickness={0.3}
        cellColor={gridCell}
        sectionSize={5}
        sectionThickness={0.5}
        sectionColor={gridSection}
        fadeDistance={18}
        fadeStrength={1}
        infiniteGrid={false}
      />
    </group>
  );
}
