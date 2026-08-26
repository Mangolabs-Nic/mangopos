import { Handle, Position } from '@xyflow/react';

const baseStyle = {
  padding: '12px 16px',
  borderRadius: '8px',
  fontSize: '13px',
  fontWeight: '500',
  textAlign: 'center',
  minWidth: '120px',
  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
};

const styles = {
  client: {
    ...baseStyle,
    background: '#4A90D9',
    color: '#fff',
    border: '2px solid #357ABD',
  },
  cloud: {
    ...baseStyle,
    background: '#E8533F',
    color: '#fff',
    border: '2px solid #C0392B',
  },
  database: {
    ...baseStyle,
    background: '#336791',
    color: '#fff',
    border: '2px solid #2C3E50',
    borderRadius: '8px 8px 20px 20px',
  },
  auth: {
    ...baseStyle,
    background: '#3ECF8E',
    color: '#fff',
    border: '2px solid #27AE60',
  },
  external: {
    ...baseStyle,
    background: '#9B59B6',
    color: '#fff',
    border: '2px solid #8E44AD',
  },
  service: {
    ...baseStyle,
    background: '#fff',
    color: '#333',
    border: '2px solid #dee2e6',
  },
  module: {
    ...baseStyle,
    background: '#f8f9fa',
    color: '#333',
    border: '2px solid #6c757d',
    fontSize: '12px',
    minWidth: '100px',
  },
};

export function ClientNode({ data }) {
  return (
    <div style={styles.client}>
      <Handle type="source" position={Position.Bottom} />
      <div style={{ fontWeight: '700', marginBottom: '4px' }}>{data.label}</div>
      {data.subtitle && <div style={{ fontSize: '11px', opacity: 0.9 }}>{data.subtitle}</div>}
    </div>
  );
}

export function CloudNode({ data }) {
  return (
    <div style={styles.cloud}>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <div style={{ fontWeight: '700', marginBottom: '4px' }}>{data.label}</div>
      {data.subtitle && <div style={{ fontSize: '11px', opacity: 0.9 }}>{data.subtitle}</div>}
    </div>
  );
}

export function DatabaseNode({ data }) {
  return (
    <div style={styles.database}>
      <Handle type="target" position={Position.Top} />
      <div style={{ fontWeight: '700', marginBottom: '4px' }}>{data.label}</div>
      {data.subtitle && <div style={{ fontSize: '11px', opacity: 0.9 }}>{data.subtitle}</div>}
    </div>
  );
}

export function AuthNode({ data }) {
  return (
    <div style={styles.auth}>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <div style={{ fontWeight: '700', marginBottom: '4px' }}>{data.label}</div>
      {data.subtitle && <div style={{ fontSize: '11px', opacity: 0.9 }}>{data.subtitle}</div>}
    </div>
  );
}

export function ExternalNode({ data }) {
  return (
    <div style={styles.external}>
      <Handle type="target" position={Position.Top} />
      <div style={{ fontWeight: '700', marginBottom: '4px' }}>{data.label}</div>
      {data.subtitle && <div style={{ fontSize: '11px', opacity: 0.9 }}>{data.subtitle}</div>}
    </div>
  );
}

export function ServiceNode({ data }) {
  return (
    <div style={styles.service}>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <div style={{ fontWeight: '700', marginBottom: '4px' }}>{data.label}</div>
      {data.subtitle && <div style={{ fontSize: '11px', opacity: 0.9, color: '#666' }}>{data.subtitle}</div>}
    </div>
  );
}

export function ModuleNode({ data }) {
  return (
    <div style={styles.module}>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <div style={{ fontWeight: '600' }}>{data.label}</div>
    </div>
  );
}

export const nodeTypes = {
  client: ClientNode,
  cloud: CloudNode,
  database: DatabaseNode,
  auth: AuthNode,
  external: ExternalNode,
  service: ServiceNode,
  module: ModuleNode,
};
