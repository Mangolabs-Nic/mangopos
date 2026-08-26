import DiagramWrapper from './DiagramWrapper';
import { nodeTypes } from './nodes';

const nodes = [
  { id: 'user', type: 'client', position: { x: 350, y: 0 }, data: { label: 'User', subtitle: '' } },
  { id: 'auth', type: 'auth', position: { x: 350, y: 120 }, data: { label: 'Supabase Auth', subtitle: 'JWT + RLS' } },
  { id: 'client', type: 'client', position: { x: 350, y: 240 }, data: { label: 'React App', subtitle: 'JWT Token' } },
  { id: 'api', type: 'cloud', position: { x: 350, y: 360 }, data: { label: 'NestJS API', subtitle: 'Bearer Token' } },
  { id: 'db', type: 'database', position: { x: 350, y: 480 }, data: { label: 'PostgreSQL', subtitle: '' } },
  { id: 'rls', type: 'auth', position: { x: 600, y: 480 }, data: { label: 'Row-Level Security', subtitle: 'Filter by business_id' } },
  { id: 'result', type: 'service', position: { x: 350, y: 580 }, data: { label: 'Filtered Results', subtitle: '' } },
];

const edges = [
  { id: 'user-auth', source: 'user', target: 'auth', label: 'Login', animated: true, style: { stroke: '#3ECF8E' } },
  { id: 'auth-client', source: 'auth', target: 'client', label: 'JWT Token', style: { stroke: '#3ECF8E', strokeDasharray: '5,5' } },
  { id: 'client-api', source: 'client', target: 'api', label: 'Bearer Token', animated: true, style: { stroke: '#4A90D9' } },
  { id: 'api-auth', source: 'api', target: 'auth', label: 'Verify JWT', style: { stroke: '#3ECF8E', strokeDasharray: '5,5' } },
  { id: 'api-db', source: 'api', target: 'db', label: 'Query with user_id', style: { stroke: '#336791' } },
  { id: 'db-rls', source: 'db', target: 'rls', label: 'RLS Policy', style: { stroke: '#FF6B6B', strokeDasharray: '5,5' } },
  { id: 'rls-result', source: 'rls', target: 'result', label: 'Filtered', animated: true, style: { stroke: '#27AE60' } },
];

export default function SecurityModelDiagram() {
  return (
    <DiagramWrapper nodes={nodes} edges={edges} nodeTypes={nodeTypes} style={{ height: '650px' }} />
  );
}
