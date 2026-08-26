import DiagramWrapper from './DiagramWrapper';
import { nodeTypes } from './nodes';

const nodes = [
  // Frontend
  { id: 'ui', type: 'module', position: { x: 50, y: 0 }, data: { label: 'UI Components' } },
  { id: 'state', type: 'module', position: { x: 200, y: 0 }, data: { label: 'State Management' } },
  { id: 'router', type: 'module', position: { x: 350, y: 0 }, data: { label: 'React Router' } },
  { id: 'api_client', type: 'module', position: { x: 500, y: 0 }, data: { label: 'API Client' } },

  // Backend
  { id: 'mod_auth', type: 'module', position: { x: 50, y: 180 }, data: { label: 'Auth Module' } },
  { id: 'mod_sales', type: 'module', position: { x: 200, y: 180 }, data: { label: 'Sales Module' } },
  { id: 'mod_inv', type: 'module', position: { x: 350, y: 180 }, data: { label: 'Inventory Module' } },
  { id: 'mod_rep', type: 'module', position: { x: 500, y: 180 }, data: { label: 'Reports Module' } },
  { id: 'mod_audit', type: 'module', position: { x: 650, y: 180 }, data: { label: 'Audit Module' } },

  // Database
  { id: 'rls', type: 'module', position: { x: 200, y: 340 }, data: { label: 'Row-Level Security' } },
  { id: 'functions', type: 'module', position: { x: 400, y: 340 }, data: { label: 'Database Functions' } },
  { id: 'triggers', type: 'module', position: { x: 600, y: 340 }, data: { label: 'Audit Triggers' } },

  // Labels
  { id: 'label_fe', type: 'service', position: { x: 50, y: -60 }, data: { label: 'Frontend (React)', subtitle: '' } },
  { id: 'label_be', type: 'service', position: { x: 50, y: 120 }, data: { label: 'Backend (NestJS)', subtitle: '' } },
  { id: 'label_db', type: 'service', position: { x: 200, y: 280 }, data: { label: 'Database (Supabase)', subtitle: '' } },
];

const edges = [
  // Frontend connections
  { id: 'ui-state', source: 'ui', target: 'state', type: 'smoothstep' },
  { id: 'state-router', source: 'state', target: 'router', type: 'smoothstep' },
  { id: 'router-api', source: 'router', target: 'api_client', type: 'smoothstep' },

  // Frontend to Backend
  { id: 'api-mod_auth', source: 'api_client', target: 'mod_auth', label: 'HTTP', type: 'smoothstep', style: { stroke: '#4A90D9' } },
  { id: 'api-mod_sales', source: 'api_client', target: 'mod_sales', label: 'HTTP', type: 'smoothstep', style: { stroke: '#4A90D9' } },
  { id: 'api-mod_inv', source: 'api_client', target: 'mod_inv', label: 'HTTP', type: 'smoothstep', style: { stroke: '#4A90D9' } },
  { id: 'api-mod_rep', source: 'api_client', target: 'mod_rep', label: 'HTTP', type: 'smoothstep', style: { stroke: '#4A90D9' } },

  // Backend to Database
  { id: 'mod_auth-rls', source: 'mod_auth', target: 'rls', type: 'smoothstep', style: { stroke: '#336791' } },
  { id: 'mod_sales-rls', source: 'mod_sales', target: 'rls', type: 'smoothstep', style: { stroke: '#336791' } },
  { id: 'mod_inv-rls', source: 'mod_inv', target: 'rls', type: 'smoothstep', style: { stroke: '#336791' } },
  { id: 'mod_rep-functions', source: 'mod_rep', target: 'functions', type: 'smoothstep', style: { stroke: '#336791' } },
  { id: 'mod_audit-triggers', source: 'mod_audit', target: 'triggers', type: 'smoothstep', style: { stroke: '#336791' } },

  // Database internal
  { id: 'rls-functions', source: 'rls', target: 'functions', type: 'smoothstep' },
];

export default function ComponentArchitectureDiagram() {
  return (
    <DiagramWrapper nodes={nodes} edges={edges} nodeTypes={nodeTypes} style={{ height: '550px' }} />
  );
}
