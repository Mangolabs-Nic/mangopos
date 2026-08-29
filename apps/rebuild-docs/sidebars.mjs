/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  rebuildSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Rebuild plan',
      items: [
        'rebuild/roadmap',
        'rebuild/decisions',
        'rebuild/data-migration',
        'rebuild/pilot-cutover',
      ],
    },
    {
      type: 'category',
      label: 'Phase 1 — Commercial foundation',
      items: [
        'rebuild/phase-1/identity',
        'rebuild/phase-1/environments',
        'rebuild/phase-1/roles',
        'rebuild/phase-1/migrations',
        'rebuild/phase-1/auditing',
      ],
    },
    {
      type: 'category',
      label: 'POS Features',
      items: [
        'features/overview',
        'features/ventas',
        'features/gastos',
        'features/inventario',
        'features/clientes',
        'features/proveedores',
        'features/empleados',
        'features/reportes',
        'features/cuentas',
        'features/configuracion',
      ],
    },
    {
      type: 'category',
      label: 'Architecture',
      items: ['architecture/overview'],
    },
    {
      type: 'category',
      label: 'Business flows',
      items: [
        'flows/sale',
        'flows/inventory',
        'flows/expense',
        'flows/reporting',
      ],
    },
    {
      type: 'category',
      label: 'Operations',
      items: [
        'operations/development',
        'operations/deployment',
        'operations/api',
        'operations/database',
        'operations/github-pages',
      ],
    },
  ],
};

export default sidebars;
