import DiagramWrapper from './DiagramWrapper';
import { nodeTypes } from './nodes';

const nodes = [
  // Development
  { id: 'dev_fe', type: 'client', position: { x: 50, y: 0 }, data: { label: 'React Dev Server', subtitle: 'localhost:3000' } },
  { id: 'dev_api', type: 'cloud', position: { x: 250, y: 0 }, data: { label: 'NestJS Dev Server', subtitle: 'localhost:4000' } },
  { id: 'dev_db', type: 'database', position: { x: 450, y: 0 }, data: { label: 'Local PostgreSQL', subtitle: 'or Supabase CLI' } },

  // Staging
  { id: 'stg_fe', type: 'client', position: { x: 50, y: 180 }, data: { label: 'Staging Frontend', subtitle: 'staging.mango-labs.dev' } },
  { id: 'stg_api', type: 'cloud', position: { x: 250, y: 180 }, data: { label: 'Staging API', subtitle: 'Railway' } },
  { id: 'stg_db', type: 'database', position: { x: 450, y: 180 }, data: { label: 'Staging Supabase', subtitle: '' } },

  // Production
  { id: 'prd_fe', type: 'client', position: { x: 50, y: 360 }, data: { label: 'Production Frontend', subtitle: 'mango-labs.dev' } },
  { id: 'prd_api', type: 'cloud', position: { x: 250, y: 360 }, data: { label: 'Production API', subtitle: 'Railway' } },
  { id: 'prd_db', type: 'database', position: { x: 450, y: 360 }, data: { label: 'Production Supabase', subtitle: '' } },

  // Labels
  { id: 'label_dev', type: 'service', position: { x: 50, y: -60 }, data: { label: 'Development', subtitle: '' } },
  { id: 'label_stg', type: 'service', position: { x: 50, y: 120 }, data: { label: 'Staging', subtitle: '' } },
  { id: 'label_prd', type: 'service', position: { x: 50, y: 300 }, data: { label: 'Production', subtitle: '' } },
];

const edges = [
  // Deploy flows
  { id: 'dev-stg-fe', source: 'dev_fe', target: 'stg_fe', label: 'deploy', type: 'smoothstep', animated: true, style: { stroke: '#27AE60' } },
  { id: 'dev-stg-api', source: 'dev_api', target: 'stg_api', label: 'deploy', type: 'smoothstep', animated: true, style: { stroke: '#27AE60' } },

  // Promote flows
  { id: 'stg-prd-fe', source: 'stg_fe', target: 'prd_fe', label: 'promote', type: 'smoothstep', animated: true, style: { stroke: '#E67E22' } },
  { id: 'stg-prd-api', source: 'stg_api', target: 'prd_api', label: 'promote', type: 'smoothstep', animated: true, style: { stroke: '#E67E22' } },
  { id: 'stg-prd-db', source: 'stg_db', target: 'prd_db', label: 'migrate', type: 'smoothstep', animated: true, style: { stroke: '#E67E22' } },
];

export default function DeploymentArchDiagram() {
  return (
    <DiagramWrapper nodes={nodes} edges={edges} nodeTypes={nodeTypes} style={{ height: '550px' }} />
  );
}
