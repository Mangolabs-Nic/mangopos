import { ReactFlow, Background, Controls, MiniMap } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const defaultViewport = { x: 0, y: 0, zoom: 1 };

export default function DiagramWrapper({ children, nodes, edges, nodeTypes, style = {} }) {
  return (
    <div style={{ height: '500px', border: '1px solid #e0e0e0', borderRadius: '8px', overflow: 'hidden', ...style }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        defaultViewport={defaultViewport}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={true}
        panOnDrag={true}
        zoomOnScroll={true}
        zoomOnPinch={true}
      >
        <Background color="#f0f0f0" gap={16} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(node) => {
            switch (node.data?.type) {
              case 'client': return '#4A90D9';
              case 'cloud': return '#E8533F';
              case 'database': return '#336791';
              case 'auth': return '#3ECF8E';
              case 'external': return '#9B59B6';
              default: return '#6c757d';
            }
          }}
          maskColor="rgba(0,0,0,0.1)"
        />
      </ReactFlow>
      {children}
    </div>
  );
}
