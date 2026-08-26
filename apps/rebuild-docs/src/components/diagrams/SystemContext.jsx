import DiagramWrapper from './DiagramWrapper';
import { nodeTypes } from './nodes';

const nodes = [
  { id: 'pos', type: 'client', position: { x: 350, y: 0 }, data: { label: 'React SPA', subtitle: 'POS Interface' } },
  { id: 'api', type: 'cloud', position: { x: 350, y: 150 }, data: { label: 'NestJS API', subtitle: 'Railway' } },
  { id: 'auth', type: 'auth', position: { x: 100, y: 150 }, data: { label: 'Supabase Auth', subtitle: 'JWT + RLS' } },
  { id: 'db', type: 'database', position: { x: 350, y: 300 }, data: { label: 'PostgreSQL', subtitle: 'Supabase' } },
  { id: 'storage', type: 'database', position: { x: 600, y: 300 }, data: { label: 'Supabase Storage', subtitle: 'Files + Receipts' } },
  { id: 'dgi', type: 'external', position: { x: 100, y: 300 }, data: { label: 'DGI Nicaragua', subtitle: 'Electronic Invoicing' } },
  { id: 'wa', type: 'external', position: { x: 600, y: 150 }, data: { label: 'WhatsApp Business', subtitle: 'Notifications' } },
];

const edges = [
  { id: 'pos-api', source: 'pos', target: 'api', label: 'HTTPS', animated: true, style: { stroke: '#4A90D9' } },
  { id: 'pos-auth', source: 'pos', target: 'auth', label: 'Auth', style: { stroke: '#3ECF8E', strokeDasharray: '5,5' } },
  { id: 'api-db', source: 'api', target: 'db', label: 'Query', animated: true, style: { stroke: '#336791' } },
  { id: 'api-storage', source: 'api', target: 'storage', label: 'Upload', style: { stroke: '#336791' } },
  { id: 'api-dgi', source: 'api', target: 'dgi', label: 'Future', style: { stroke: '#9B59B6', strokeDasharray: '5,5' } },
  { id: 'api-wa', source: 'api', target: 'wa', label: 'Future', style: { stroke: '#9B59B6', strokeDasharray: '5,5' } },
];

export default function SystemContextDiagram() {
  return (
    <DiagramWrapper nodes={nodes} edges={edges} nodeTypes={nodeTypes} />
  );
}
