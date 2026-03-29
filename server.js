// backend/server.js
// ─────────────────────────────────────────────────────────────────────────────
// ANABEN SOLUTIONS — Parcel Tracking API Server
// Node.js + Express + (Firebase Firestore as DB)
// Run: node server.js
// ─────────────────────────────────────────────────────────────────────────────

const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const morgan   = require('morgan');
const rateLimit= require('express-rate-limit');
const crypto   = require('crypto');

const app  = express();
app.use(express.static(__dirname));
const PORT = process.env.PORT || 3001;

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: ['http://localhost:3000', 'https://anabensolutions.com', 'https://www.anabensolutions.com'] }));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined'));

// Rate limiting — tracking endpoint
const trackLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 100,
  message: { error: 'Too many tracking requests. Please try again in 15 minutes.' },
});

// ─────────────────────────────────────────────────────────────────────────────
// IN-MEMORY TRACKING DATABASE (Replace with Firestore in production)
// ─────────────────────────────────────────────────────────────────────────────
const SHIPMENTS_DB = new Map();

// Stage definitions matching the app
const ALL_STAGES = [
  'booking_confirmed',
  'export_docs_ready',
  'uk_customs_cleared',
  'cargo_collected',
  'at_uk_warehouse',
  'ectn_filed',
  'at_port_uk',
  'vessel_departed',
  'in_transit',
  'arrived_tema',
  'ghana_customs',
  'customs_released',
  'out_for_delivery',
  'delivered',
];

const STAGE_LABELS = {
  booking_confirmed:  'Booking Confirmed',
  export_docs_ready:  'Export Documents Prepared',
  uk_customs_cleared: 'UK Customs Export Cleared',
  cargo_collected:    'Cargo Collected',
  at_uk_warehouse:    'At UK Consolidation Depot',
  ectn_filed:         'ECTN Filed',
  at_port_uk:         'Arrived at UK Port / Airport',
  vessel_departed:    'Vessel / Flight Departed',
  in_transit:         'In Transit',
  arrived_tema:       'Arrived — Tema Port / KIA',
  ghana_customs:      'Ghana Customs Clearance',
  customs_released:   'Customs Released',
  out_for_delivery:   'Out for Delivery',
  delivered:          'Delivered to Consignee',
};

// Seed demo shipments
function seedDemoShipments() {
  const demos = [
    {
      trackingNumber: 'ANB-2026-001234',
      direction:      'uk_to_gh',
      mode:           'Ocean FCL',
      service:        'Anaben Ocean Standard',
      status:         'in_transit',
      vessel:         'MSC AURORA — Voyage 241W',
      container:      'MSCU7841234',
      currentStage:   'in_transit',
      shipper:        { name: 'Anaben Solutions UK', reference: 'ORD-45021' },
      consignee:      { name: 'Kwame Mensah Enterprises', city: 'Accra, Ghana' },
      origin:         { country: 'United Kingdom', city: 'Chadwell Heath, Essex', port: 'Felixstowe', postcode: 'RM6 6AX' },
      destination:    { country: 'Ghana', city: 'Accra', port: 'Tema Port' },
      cargo: {
        description:   'General Cargo / Electronics',
        commodity:     'General',
        quantity:      '3 pallets',
        weight:        '2,450 kg',
        volume:        '12 CBM',
        declaredValue: '£18,500',
        insurance:     'Institute Cargo Clauses (A)',
        condition:     'GOOD',
        packages: [
          { id: 'PKG-001', description: 'Electronics — Laptops x20', weight: '120 kg', seal: 'ANB-841201' },
          { id: 'PKG-002', description: 'General Merchandise',         weight: '1,800 kg', seal: 'ANB-841202' },
          { id: 'PKG-003', description: 'Household Goods',             weight: '530 kg', seal: 'ANB-841203' },
        ],
      },
      dates: {
        booked:       daysAgo(18),
        collected:    daysAgo(15),
        portDeparted: daysAgo(12),
        eta:          daysAhead(8),
        delivered:    null,
      },
      currentLocation: {
        description: 'Atlantic Ocean — Approaching West African Coast',
        lat: 3.2, lng: -2.1,
        updatedAt: daysAgo(0.1),
      },
      documents: [
        { name: 'Bill of Lading',       type: 'BOL',     status: 'issued',   date: daysAgo(12) },
        { name: 'Commercial Invoice',   type: 'Invoice', status: 'verified', date: daysAgo(15) },
        { name: 'Certificate of Origin',type: 'COO',     status: 'verified', date: daysAgo(15) },
        { name: 'Packing List',         type: 'PL',      status: 'verified', date: daysAgo(15) },
        { name: 'ECTN Certificate',     type: 'ECTN',    status: 'filed',    date: daysAgo(12) },
      ],
      customsDuties: {
        cif: 18500, importDuty: 1850, ecowasLevy: 92.50, edif: 92.50,
        vat: 3064.88, getFundLevy: 229.87, processingFee: 74,
        total: 5403.75, currency: 'GBP', status: 'pending',
      },
      alerts: [],
      timeline: [
        { id: 'booking_confirmed',  completedAt: daysAgo(18), location: 'Anaben Solutions, Chadwell Heath, Essex, RM6 6AX', scannedBy: 'Anaben Operations Team',   condition: 'GOOD', note: 'Booking confirmed. Ocean FCL service. Reference: UK-2026-001234.' },
        { id: 'export_docs_ready',  completedAt: daysAgo(17), location: 'Anaben Solutions, Essex, UK',                      scannedBy: 'Anaben Compliance Team',   condition: 'GOOD', note: 'All export documents prepared and verified.' },
        { id: 'uk_customs_cleared', completedAt: daysAgo(16), location: 'HMRC CDS — United Kingdom',                         scannedBy: 'HMRC Automated System',   condition: 'GOOD', note: 'Export declaration accepted. CDS Entry Ref: GB2026-0034567. Green channel.' },
        { id: 'cargo_collected',    completedAt: daysAgo(15), location: 'Shipper Premises, Birmingham, UK',                  scannedBy: 'Anaben Driver — D. Osei', condition: 'GOOD', note: 'Cargo collected. Weight verified: 2,450 kg. All 3 packages intact. Seal ANB-841201/02/03 applied.' },
        { id: 'at_uk_warehouse',    completedAt: daysAgo(14), location: 'Anaben Depot, Chadwell Heath, Essex, RM6 6AX',      scannedBy: 'Warehouse — K. Mensah',  condition: 'GOOD', note: 'Cargo received at depot. Palletised and wrapped. Allocated to container MSCU7841234.' },
        { id: 'ectn_filed',         completedAt: daysAgo(13), location: 'ECTN Registry — West Africa',                        scannedBy: 'Anaben Compliance',       condition: 'GOOD', note: 'ECTN/BSC filed and approved. Certificate No: ECTN-2026-GH-83421.' },
        { id: 'at_port_uk',         completedAt: daysAgo(12), location: 'Port of Felixstowe — Terminal 2',                   scannedBy: 'Port Authority Scanner',  condition: 'GOOD', note: 'VGM submitted: 24,850 kg. Container loaded to vessel MSC AURORA. Seal verified.' },
        { id: 'vessel_departed',    completedAt: daysAgo(12), location: 'Port of Felixstowe — Departed',                     scannedBy: 'MSC Carrier System',      condition: 'GOOD', note: 'Vessel MSC AURORA departed Felixstowe 06:00 GMT. Voyage 241W. ETA Tema: 18 days.' },
        { id: 'in_transit',         completedAt: null, isActive: true, location: 'Atlantic Ocean — 1,240 nm from Tema', scannedBy: 'AIS Vessel Tracker', condition: 'GOOD', note: 'Vessel on schedule. Speed: 16.2 knots. Weather: Clear. ETA Tema unchanged.' },
      ],
      proofOfDelivery: null,
    },
    {
      trackingNumber: 'ANB-AIR-001235',
      direction:      'uk_to_gh',
      mode:           'Air Freight',
      service:        'Anaben Air Express',
      status:         'out_for_delivery',
      vessel:         'British Airways Cargo BA072',
      container:      null,
      currentStage:   'out_for_delivery',
      shipper:        { name: 'MedPharm UK Ltd', reference: 'MED-2026-089' },
      consignee:      { name: 'Accra Medical Centre', city: 'Accra, Ghana' },
      origin:         { country: 'United Kingdom', city: 'Heathrow, London', port: 'London Heathrow (LHR)', postcode: 'TW6 2GW' },
      destination:    { country: 'Ghana', city: 'Accra', port: 'Kotoka International Airport (KIA)' },
      cargo: {
        description:   'Pharmaceutical Supplies — Temperature Controlled',
        commodity:     'Pharmaceuticals',
        quantity:      '12 cartons',
        weight:        '185 kg',
        volume:        '1.2 CBM',
        declaredValue: '£42,000',
        insurance:     'Institute Cargo Clauses (A) — Pharma Extension',
        condition:     'GOOD',
        packages: [
          { id: 'PKG-001', description: 'Vaccines — Cold Chain 2-8°C', weight: '45 kg', seal: 'ANB-AIR-001' },
          { id: 'PKG-002', description: 'Medical Devices',              weight: '80 kg', seal: 'ANB-AIR-002' },
          { id: 'PKG-003', description: 'Prescription Medications',     weight: '60 kg', seal: 'ANB-AIR-003' },
        ],
      },
      dates: { booked: daysAgo(5), collected: daysAgo(4), portDeparted: daysAgo(3), eta: daysAhead(0), delivered: null },
      currentLocation: { description: 'GIG Logistics Ghana — Accra Depot, out for delivery', lat: 5.6, lng: -0.2, updatedAt: daysAgo(0.05) },
      documents: [
        { name: 'Air Waybill',           type: 'AWB',     status: 'issued',   date: daysAgo(3) },
        { name: 'Commercial Invoice',    type: 'Invoice', status: 'verified', date: daysAgo(4) },
        { name: 'Phytosanitary Cert',    type: 'Phyto',   status: 'verified', date: daysAgo(4) },
        { name: 'Dangerous Goods Decl',  type: 'DGD',     status: 'filed',    date: daysAgo(3) },
        { name: 'Temperature Log',       type: 'TempLog', status: 'verified', date: daysAgo(0.1) },
      ],
      customsDuties: { cif: 42000, importDuty: 0, ecowasLevy: 210, edif: 210, vat: 6363, getFundLevy: 477.23, processingFee: 168, total: 7428.23, currency: 'GBP', status: 'paid' },
      alerts: [],
      timeline: [
        { id: 'booking_confirmed',  completedAt: daysAgo(5),    location: 'Anaben Solutions, Essex, UK',                    scannedBy: 'Anaben Ops',             condition: 'GOOD', note: 'Booking confirmed. Air Express — Critical tier. Cold chain required.' },
        { id: 'export_docs_ready',  completedAt: daysAgo(4.5),  location: 'Anaben Solutions, Essex',                         scannedBy: 'Anaben Compliance',      condition: 'GOOD', note: 'DG declaration completed. Pharma docs verified.' },
        { id: 'uk_customs_cleared', completedAt: daysAgo(4),    location: 'HMRC CDS',                                        scannedBy: 'HMRC CDS',               condition: 'GOOD', note: 'Export cleared. Pharma export licence verified.' },
        { id: 'cargo_collected',    completedAt: daysAgo(4),    location: 'MedPharm UK Ltd, Slough',                         scannedBy: 'Anaben Driver — P. Boateng', condition: 'GOOD', note: 'Cold chain pickup. Temperature verified: 4°C. 12 cartons collected.' },
        { id: 'at_uk_warehouse',    completedAt: daysAgo(3.5),  location: 'LHR Cold Store — Cargo Terminal 4',               scannedBy: 'LHR Cold Store Team',    condition: 'GOOD', note: 'Cold store received. Temp: 4°C. BA Cargo booked.' },
        { id: 'ectn_filed',         completedAt: daysAgo(3),    location: 'ECTN Registry',                                   scannedBy: 'Anaben Compliance',      condition: 'GOOD', note: 'ECTN filed. Certificate: ECTN-2026-GH-AIR-00891.' },
        { id: 'at_port_uk',         completedAt: daysAgo(3),    location: 'London Heathrow — Cargo Terminal 4',              scannedBy: 'BA Cargo Scanner',       condition: 'GOOD', note: 'AWB accepted. Flight BA072 confirmed. Aircraft: Boeing 777F.' },
        { id: 'vessel_departed',    completedAt: daysAgo(3),    location: 'London Heathrow — Airborne',                      scannedBy: 'British Airways Cargo',  condition: 'GOOD', note: 'Flight BA072 departed 14:35 GMT. Cold chain maintained at 4°C.' },
        { id: 'in_transit',         completedAt: daysAgo(2.9),  location: 'West African Airspace',                           scannedBy: 'BA Cargo Tracking',      condition: 'GOOD', note: 'On schedule. Cold chain confirmed.' },
        { id: 'arrived_tema',       completedAt: daysAgo(2),    location: 'Kotoka International Airport (KIA), Accra',       scannedBy: 'KIA Cargo Authority',    condition: 'GOOD', note: 'Arrived KIA 21:20 GMT. Cold store transfer. Temp: 4°C.' },
        { id: 'ghana_customs',      completedAt: daysAgo(1.5),  location: 'Ghana Revenue Authority — KIA',                   scannedBy: 'GRA — Accra',            condition: 'GOOD', note: 'FDA Ghana clearance obtained. Pharma import permit verified.' },
        { id: 'customs_released',   completedAt: daysAgo(0.5),  location: 'KIA Cargo — Accra, Ghana',                        scannedBy: 'GRA Release Officer',    condition: 'GOOD', note: 'All duties paid. Cargo released. Delivery order issued to GIG Logistics.' },
        { id: 'out_for_delivery',   completedAt: null, isActive: true, location: 'GIG Logistics — Accra, Ghana', scannedBy: 'GIG Logistics Driver', condition: 'GOOD', note: 'Driver assigned: E. Asante. Vehicle: GH-3421-22. ETA: Today 14:00 GMT.' },
      ],
      proofOfDelivery: null,
    },
    {
      trackingNumber: 'ANB-GH-001236',
      direction:      'gh_to_uk',
      mode:           'Ocean FCL',
      service:        'Anaben Ocean Standard — Ghana Export',
      status:         'at_port_uk',
      vessel:         'CMA CGM AFRICA — Voyage W18',
      container:      'CMAU5219043',
      currentStage:   'at_port_uk',
      shipper:        { name: 'Ashanti Cocoa Exports Ltd', reference: 'COCOA-2026-0221' },
      consignee:      { name: 'Godiva UK Imports Ltd', city: 'London, United Kingdom' },
      origin:         { country: 'Ghana', city: 'Tema, Greater Accra', port: 'Tema Port', postcode: null },
      destination:    { country: 'United Kingdom', city: 'Tilbury, Essex', port: 'Port of Tilbury' },
      cargo: {
        description:   'Cocoa Beans — COCOBOD Certified Grade 1',
        commodity:     'Agricultural',
        quantity:      '1 FCL x 20\'',
        weight:        '18,200 kg',
        volume:        '24 CBM',
        declaredValue: '£62,000',
        insurance:     'Institute Cargo Clauses (A) — Agricultural Extension',
        condition:     'GOOD',
        packages: [
          { id: 'PKG-001', description: 'Cocoa Beans Grade 1 — Jute Bags x820', weight: '18,200 kg', seal: 'COCOBOD-2026-GH-0441' },
        ],
      },
      dates: { booked: daysAgo(25), collected: daysAgo(22), portDeparted: daysAgo(20), eta: daysAhead(2), delivered: null },
      currentLocation: { description: 'Port of Tilbury — Awaiting UK Customs Clearance', lat: 51.4, lng: 0.35, updatedAt: daysAgo(0.2) },
      documents: [
        { name: 'Bill of Lading',         type: 'BOL',      status: 'issued',   date: daysAgo(20) },
        { name: 'COCOBOD Certificate',    type: 'COCOBOD',  status: 'verified', date: daysAgo(22) },
        { name: 'Phytosanitary Cert',     type: 'Phyto',    status: 'verified', date: daysAgo(22) },
        { name: 'Certificate of Origin',  type: 'COO',      status: 'verified', date: daysAgo(22) },
        { name: 'Commercial Invoice',     type: 'Invoice',  status: 'verified', date: daysAgo(22) },
        { name: 'Packing List',           type: 'PL',       status: 'verified', date: daysAgo(22) },
      ],
      customsDuties: null,
      alerts: [
        { type: 'docs', message: 'UK Port Health inspection scheduled for tomorrow 09:00. Phytosanitary certificate available.' },
      ],
      timeline: [
        { id: 'booking_confirmed',  completedAt: daysAgo(25), location: 'Anaben Ghana Partner, Accra',           scannedBy: 'Anaben Ghana Team',      condition: 'GOOD', note: 'Export booking confirmed. COCOBOD licence verified.' },
        { id: 'export_docs_ready',  completedAt: daysAgo(23), location: 'GEPA — Accra, Ghana',                   scannedBy: 'GEPA Certifying Officer',condition: 'GOOD', note: 'Certificate of Origin issued. COCOBOD Grade 1 certificate attached.' },
        { id: 'uk_customs_cleared', completedAt: daysAgo(22), location: 'GCNet — Ghana Revenue Authority',       scannedBy: 'GRA Export Officer',     condition: 'GOOD', note: 'Ghana export declaration filed and cleared. Cargo may depart.' },
        { id: 'cargo_collected',    completedAt: daysAgo(22), location: 'Ashanti Cocoa Warehouse, Tema',         scannedBy: 'Anaben Ghana Driver',    condition: 'GOOD', note: 'Cocoa beans collected. Weight verified: 18,200 kg. COCOBOD seal intact.' },
        { id: 'at_uk_warehouse',    completedAt: daysAgo(21), location: 'Tema ICD — Container Freight Station',  scannedBy: 'Tema ICD Scanner',       condition: 'GOOD', note: 'Container stuffed at Tema ICD. Seal applied: CMAU-2026-GH-001.' },
        { id: 'ectn_filed',         completedAt: daysAgo(21), location: 'ECTN Registry — Ghana',                 scannedBy: 'Anaben Ghana Compliance',condition: 'GOOD', note: 'ECTN filed for UK-bound vessel.' },
        { id: 'at_port_uk',         completedAt: daysAgo(20), location: 'Tema Port — Terminal 2, Ghana',         scannedBy: 'GPHA Port Authority',    condition: 'GOOD', note: 'Container delivered to Tema Port. Vessel CMA CGM AFRICA confirmed.' },
        { id: 'vessel_departed',    completedAt: daysAgo(20), location: 'Tema Port — Departed',                  scannedBy: 'CMA CGM System',         condition: 'GOOD', note: 'Vessel departed Tema 22:00 GMT. Voyage W18. ETA Tilbury: 20 days.' },
        { id: 'in_transit',         completedAt: daysAgo(3),  location: 'Atlantic Ocean — Bay of Biscay',        scannedBy: 'AIS Vessel Tracker',     condition: 'GOOD', note: 'Vessel on schedule. Speed: 17.1 knots. ETA Tilbury unchanged.' },
        { id: 'arrived_tema',       completedAt: daysAgo(0.5), location: 'Port of Tilbury, Essex, United Kingdom', scannedBy: 'Port of Tilbury Authority', condition: 'GOOD', note: 'Vessel berthed Tilbury 06:30 GMT. Container discharged. UK Border Force notified.' },
        { id: 'at_port_uk',         completedAt: null, isActive: true, location: 'Port of Tilbury — Customs Examination Bay', scannedBy: 'HMRC UK Border Force', condition: 'GOOD', note: 'UK import declaration filed. Port Health inspection scheduled. EPA tariff preference applied.' },
      ],
      proofOfDelivery: null,
    },
  ];

  demos.forEach(s => SHIPMENTS_DB.set(s.trackingNumber, s));
  console.log(`✅ Seeded ${demos.length} demo shipments`);
}

function daysAgo(d)   { return new Date(Date.now() - d * 86400000).toISOString(); }
function daysAhead(d) { return new Date(Date.now() + d * 86400000).toISOString(); }

seedDemoShipments();

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY — generate tracking number
// ─────────────────────────────────────────────────────────────────────────────
function generateTrackingNumber(mode, direction) {
  const yr  = new Date().getFullYear();
  const seq = crypto.randomInt(100000, 999999);
  if (mode === 'air') return `ANB-AIR-${seq}`;
  if (direction === 'gh_to_uk') return `ANB-GH-${seq}`;
  return `ANB-${yr}-${seq}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MIDDLEWARE — auth (simple token check, replace with Firebase Auth)
// ─────────────────────────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorised' });
  // In production: verify Firebase ID token
  req.userId = 'demo-user';
  next();
}

function adminMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !token.startsWith('admin-')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Anaben Solutions Tracking API', timestamp: new Date().toISOString() });
});

// ── PUBLIC: Track by tracking number ─────────────────────────────────────────
app.get('/v1/shipments/track/:trackingNumber', trackLimit, (req, res) => {
  const { trackingNumber } = req.params;
  const key = trackingNumber.trim().toUpperCase();
  const shipment = SHIPMENTS_DB.get(key);

  if (!shipment) {
    return res.status(404).json({
      error:   'Tracking number not found',
      message: `No shipment found with tracking number ${key}. Please check the number and try again, or contact Anaben Solutions at info@anabensolutions.com`,
      contact: { email: 'info@anabensolutions.com', phone: '+44 738 034 5572', web: 'www.anabensolutions.com' },
    });
  }

  // Sanitise output — don't expose internal IDs for public tracking
  const { ...safe } = shipment;
  res.json(safe);
});

// ── AUTH: Get all shipments for logged-in user ────────────────────────────────
app.get('/v1/shipments', authMiddleware, (req, res) => {
  const { limit = 20, page = 1, status, direction } = req.query;
  let results = Array.from(SHIPMENTS_DB.values());
  if (status)    results = results.filter(s => s.status === status);
  if (direction) results = results.filter(s => s.direction === direction);
  const total  = results.length;
  const offset = (page - 1) * limit;
  const sliced = results.slice(offset, offset + parseInt(limit));
  res.json({
    shipments: sliced,
    pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / limit) },
    stats: {
      total,
      inTransit: results.filter(s => s.status === 'in_transit').length,
      delivered: results.filter(s => s.status === 'delivered').length,
      pending:   results.filter(s => s.status === 'pending').length,
    },
  });
});

// ── AUTH: Get single shipment ─────────────────────────────────────────────────
app.get('/v1/shipments/:id', authMiddleware, (req, res) => {
  const shipment = SHIPMENTS_DB.get(req.params.id.toUpperCase());
  if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
  res.json(shipment);
});

// ── AUTH: Create new shipment booking ────────────────────────────────────────
app.post('/v1/shipments', authMiddleware, (req, res) => {
  const {
    direction, mode, commodity, weight, volume, quantity, description,
    declaredValue, pickupAddress, pickupCity, pickupPostcode, pickupDate,
    deliveryAddress, deliveryCity, contactName, contactPhone,
    insurance, customs, doorToDoor, urgency, incoterm,
    specialInstructions, quoteId,
  } = req.body;

  if (!direction || !mode || !commodity) {
    return res.status(400).json({ error: 'direction, mode, and commodity are required' });
  }

  const trackingNumber = generateTrackingNumber(mode, direction);
  const now = new Date().toISOString();

  const shipment = {
    id:             trackingNumber,
    trackingNumber,
    direction,
    mode:           mode.replace('_', ' ').toUpperCase(),
    service:        urgency === 'critical' ? 'Anaben Critical' : urgency === 'expedited' ? 'Anaben Expedited' : 'Anaben Standard',
    status:         'pending',
    currentStage:   'booking_confirmed',
    vessel:         null,
    container:      null,
    quoteId:        quoteId || null,
    shipper: {
      name:      `${req.userId} — via Anaben Solutions`,
      reference: `ORD-${crypto.randomInt(10000, 99999)}`,
    },
    consignee: {
      name: contactName,
      city: deliveryCity,
    },
    origin: {
      country:  direction === 'uk_to_gh' ? 'United Kingdom' : 'Ghana',
      city:     pickupCity,
      postcode: pickupPostcode,
      address:  pickupAddress,
    },
    destination: {
      country: direction === 'uk_to_gh' ? 'Ghana' : 'United Kingdom',
      city:    deliveryCity,
      address: deliveryAddress,
    },
    cargo: {
      description, commodity, quantity, weight, volume,
      declaredValue, condition: 'GOOD',
      insurance: insurance ? 'Institute Cargo Clauses (A)' : 'Not included',
      specialInstructions,
    },
    services: { insurance, customs, doorToDoor, urgency, incoterm },
    dates: {
      booked:       now,
      pickupDate:   pickupDate || null,
      collected:    null,
      portDeparted: null,
      eta:          null,
      delivered:    null,
    },
    currentLocation: {
      description: 'Booking Processing — Anaben Solutions, Essex, UK',
      lat: 51.5, lng: 0.14,
      updatedAt: now,
    },
    documents: [],
    customsDuties: null,
    alerts:  [],
    timeline: [
      {
        id:          'booking_confirmed',
        completedAt: now,
        location:    'Anaben Solutions, Chadwell Heath, Essex, RM6 6AX',
        scannedBy:   'Anaben Operations System',
        condition:   'GOOD',
        note:        `Booking confirmed. ${mode} service. Pickup scheduled: ${pickupCity}. Contact: ${contactPhone}`,
      },
    ],
    proofOfDelivery: null,
    createdAt: now,
    updatedAt: now,
  };

  SHIPMENTS_DB.set(trackingNumber, shipment);
  res.status(201).json({ ...shipment, message: 'Shipment booked successfully. Our team will contact you within 2 hours to confirm collection.' });
});

// ── AUTH: Get tracking timeline ───────────────────────────────────────────────
app.get('/v1/shipments/:id/timeline', authMiddleware, (req, res) => {
  const shipment = SHIPMENTS_DB.get(req.params.id.toUpperCase());
  if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
  res.json({ events: shipment.timeline || [], stages: ALL_STAGES.map(id => ({ id, label: STAGE_LABELS[id] })) });
});

// ── ADMIN: Update shipment status + add timeline event ────────────────────────
app.put('/v1/admin/shipments/:id/status', adminMiddleware, (req, res) => {
  const { status, location, note, scannedBy, condition, lat, lng } = req.body;
  const shipment = SHIPMENTS_DB.get(req.params.id.toUpperCase());

  if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
  if (!ALL_STAGES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status', validStatuses: ALL_STAGES });
  }

  const now = new Date().toISOString();

  // Mark previous active events as complete
  shipment.timeline = shipment.timeline.map(e => ({
    ...e,
    isActive: false,
    completedAt: e.completedAt || (e.isActive ? now : null),
  }));

  // Add new timeline event
  const isDelivered = status === 'delivered';
  shipment.timeline.push({
    id:          status,
    completedAt: isDelivered ? now : null,
    isActive:    !isDelivered,
    location:    location || STAGE_LABELS[status],
    scannedBy:   scannedBy || 'Anaben Operations',
    condition:   condition || 'GOOD',
    note:        note || `Status updated to: ${STAGE_LABELS[status]}`,
  });

  // Update current location
  shipment.currentLocation = {
    description: location || STAGE_LABELS[status],
    lat: lat || shipment.currentLocation?.lat,
    lng: lng || shipment.currentLocation?.lng,
    updatedAt: now,
  };

  shipment.status       = status;
  shipment.currentStage = status;
  shipment.updatedAt    = now;

  // If delivered, create POD
  if (isDelivered) {
    shipment.proofOfDelivery = {
      deliveredAt:   now,
      recipientName: req.body.recipientName || shipment.consignee?.name,
      location:      location || shipment.destination?.city,
      signature:     req.body.signature || null,
      photoUrl:      req.body.photoUrl   || null,
      notes:         note || 'Delivered successfully',
    };
    shipment.dates.delivered = now;
  }

  SHIPMENTS_DB.set(shipment.trackingNumber, shipment);
  res.json({ message: `Shipment updated to ${STAGE_LABELS[status]}`, shipment });
});

// ── ADMIN: Get all shipments ──────────────────────────────────────────────────
app.get('/v1/admin/shipments', adminMiddleware, (req, res) => {
  const { limit = 50, page = 1, status, direction, mode } = req.query;
  let results = Array.from(SHIPMENTS_DB.values());
  if (status)    results = results.filter(s => s.status === status);
  if (direction) results = results.filter(s => s.direction === direction);
  if (mode)      results = results.filter(s => s.mode?.toLowerCase().includes(mode.toLowerCase()));
  results.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const total  = results.length;
  const sliced = results.slice((page - 1) * limit, page * limit);
  res.json({ shipments: sliced, total, page: parseInt(page), pages: Math.ceil(total / limit) });
});

// ── ADMIN: Dashboard stats ────────────────────────────────────────────────────
app.get('/v1/admin/stats', adminMiddleware, (req, res) => {
  const all = Array.from(SHIPMENTS_DB.values());
  const today = new Date(); today.setHours(0,0,0,0);
  res.json({
    totalShipments: all.length,
    activeShipments: all.filter(s => !['delivered','cancelled'].includes(s.status)).length,
    deliveredToday:  all.filter(s => s.status === 'delivered' && new Date(s.dates?.delivered) >= today).length,
    pendingApprovals:all.filter(s => s.status === 'pending').length,
    ukToGhana:       all.filter(s => s.direction === 'uk_to_gh').length,
    ghToUk:          all.filter(s => s.direction === 'gh_to_uk').length,
    revenue:         all.reduce((sum, s) => sum + (parseFloat(s.cargo?.declaredValue?.replace(/[^0-9.]/g,'') || 0) * 0.08), 0).toFixed(2),
    totalUsers:      42,
  });
});

// ── ADMIN: Add alert to shipment ──────────────────────────────────────────────
app.post('/v1/admin/shipments/:id/alerts', adminMiddleware, (req, res) => {
  const { type, message } = req.body;
  const shipment = SHIPMENTS_DB.get(req.params.id.toUpperCase());
  if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
  if (!shipment.alerts) shipment.alerts = [];
  shipment.alerts.push({ type, message, createdAt: new Date().toISOString() });
  SHIPMENTS_DB.set(shipment.trackingNumber, shipment);
  res.json({ message: 'Alert added', alerts: shipment.alerts });
});

// ── AUTH: Upload document ─────────────────────────────────────────────────────
app.post('/v1/shipments/:id/documents', authMiddleware, (req, res) => {
  const shipment = SHIPMENTS_DB.get(req.params.id.toUpperCase());
  if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
  const { name, type, url } = req.body;
  const doc = { name, type: type || 'Other', status: 'uploaded', date: new Date().toISOString(), url: url || null };
  if (!shipment.documents) shipment.documents = [];
  shipment.documents.push(doc);
  SHIPMENTS_DB.set(shipment.trackingNumber, shipment);
  res.json({ message: 'Document uploaded', document: doc });
});

// ── AUTH: Get documents ───────────────────────────────────────────────────────
app.get('/v1/shipments/:id/documents', authMiddleware, (req, res) => {
  const shipment = SHIPMENTS_DB.get(req.params.id.toUpperCase());
  if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
  res.json({ documents: shipment.documents || [] });
});

// ── Quote calculation ─────────────────────────────────────────────────────────
app.post('/v1/quotes/calculate', authMiddleware, (req, res) => {
  const { mode, weight, volume, insurance, customs, doorToDoor, urgency, direction } = req.body;
  const w = parseFloat(weight) || 0;
  const v = parseFloat(volume) || 0;

  const baseRates = { ocean_fcl: 1200, ocean_lcl: 45, air: 9, roro: 800 };
  const urgencyMult = { standard: 1, expedited: 1.25, critical: 1.8 };

  const base     = mode === 'ocean_lcl' ? baseRates[mode] * Math.max(w / 1000, v) : baseRates[mode] || 1200;
  const freight  = base * (urgencyMult[urgency] || 1);
  const origin   = freight * 0.10;
  const dest     = freight * 0.15;
  const ins      = insurance ? freight * 0.05  : 0;
  const cust     = customs   ? freight * 0.07  : 0;
  const lastMile = doorToDoor? freight * 0.08  : 0;
  const total    = freight + origin + dest + ins + cust + lastMile;

  const transitMap = {
    ocean_fcl: direction === 'uk_to_gh' ? '18–25 days' : '20–28 days',
    ocean_lcl: direction === 'uk_to_gh' ? '25–35 days' : '28–38 days',
    air:       urgency === 'critical'   ? '1–2 days'   : '3–5 days',
    roro:      '20–28 days',
  };

  res.json({
    id:          `QT-${Date.now()}`,
    total:       parseFloat(total.toFixed(2)),
    currency:    'GBP',
    breakdown: {
      freight:   parseFloat(freight.toFixed(2)),
      origin:    parseFloat(origin.toFixed(2)),
      destination:parseFloat(dest.toFixed(2)),
      insurance: parseFloat(ins.toFixed(2)),
      customs:   parseFloat(cust.toFixed(2)),
      lastMile:  parseFloat(lastMile.toFixed(2)),
    },
    transitDays: transitMap[mode] || '18–25 days',
    validUntil:  new Date(Date.now() + 3 * 86400000).toISOString(),
    notes:       'Estimate only. Final rate confirmed by Anaben on booking.',
  });
});



// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║       ANABEN SOLUTIONS — Tracking API Server         ║');
  console.log(`║       Running on http://localhost:${PORT}               ║`);
  console.log('║       UK ↔ Ghana Freight & Concierge                 ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Available endpoints:');
  console.log(`  GET  /health`);
  console.log(`  GET  /v1/shipments/track/:trackingNumber  (public)`);
  console.log(`  GET  /v1/shipments                        (auth required)`);
  console.log(`  POST /v1/shipments                        (auth required)`);
  console.log(`  GET  /v1/shipments/:id/timeline           (auth required)`);
  console.log(`  POST /v1/quotes/calculate                 (auth required)`);
  console.log(`  GET  /v1/admin/stats                      (admin)`);
  console.log(`  GET  /v1/admin/shipments                  (admin)`);
  console.log(`  PUT  /v1/admin/shipments/:id/status       (admin)`);
  console.log('');
  console.log('Demo tracking numbers:');
  console.log('  ANB-2026-001234  (UK → Ghana, Ocean FCL, in transit)');
  console.log('  ANB-AIR-001235   (UK → Ghana, Air, out for delivery)');
  console.log('  ANB-GH-001236    (Ghana → UK, Ocean FCL, at UK port)');
  console.log('');
});
