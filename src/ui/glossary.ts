/** Plain-language definitions shown in tooltips and in the glossary dialog. */
export const GLOSSARY: Record<string, { term: string; text: string }> = {
  dimension: {
    term: 'Dimension',
    text: 'The number of independent directions you can move in. Our world has 3 (x, y, z). 4D space adds a fourth direction, w, at right angles to all three.',
  },
  hiddenAxis: {
    term: 'Hidden axis',
    text: 'An axis outside our 3D world: w in 4D, plus v, u, … in higher dimensions. We only ever see where a shape crosses our slice.',
  },
  slice: {
    term: 'Slice (cross-section)',
    text: 'The part of a shape that lies inside our 3D world. A Flatlander sees a sphere passing through their plane as a circle that grows and shrinks; we see a 4D shape as a 3D slice that morphs.',
  },
  hyperplane: {
    term: 'Hyperplane',
    text: 'A flat space one dimension lower than the space around it. In 4D a hyperplane is an entire 3D space, like ours: everything with w equal to some constant.',
  },
  sliceOffset: {
    term: 'Slice offset',
    text: 'Where our 3D world sits along a hidden axis. Sliding it scans through the shape. Moving the slice by +d looks exactly like moving the shape by −d.',
  },
  rotationPlane: {
    term: 'Rotation plane',
    text: 'Rotations happen in a plane spanned by two axes, not around an axis. Points move within that plane and every other coordinate stays put. n dimensions have n(n−1)/2 planes: 4D has six (xy, xz, xw, yz, yw, zw).',
  },
  mixingPlane: {
    term: 'Plane through a hidden axis',
    text: 'A rotation plane with one visible and one hidden axis, like xw. Rotating in it trades parts of the shape between our world and the hidden direction, so the slice changes shape instead of just spinning.',
  },
  hiddenPlane: {
    term: 'Hidden plane',
    text: 'A rotation plane made of two hidden axes (like wv in 5D). It leaves our slice untouched when the slice passes through the origin.',
  },
  commute: {
    term: 'Commuting operations',
    text: 'Two operations commute if doing them in either order gives the same result. Rotations in planes that share no axis (xy and zw) commute; rotations in planes that share an axis (xy and yz) usually do not.',
  },
  transformStack: {
    term: 'Transform stack',
    text: 'The ordered list of operations applied to a shape. They run top to bottom, each one measured against the fixed world axes. Reorder them to see when order matters.',
  },
  polytope: {
    term: 'Polytope',
    text: 'A flat-sided shape in any dimension: a polygon in 2D, a polyhedron in 3D, a polychoron in 4D, and so on.',
  },
  cell: {
    term: 'Cell',
    text: 'A 3D piece of a 4D polytope’s boundary, just as a face is a 2D piece of a solid’s boundary. A tesseract is bounded by 8 cubic cells. Each face of a slice is cut from one cell.',
  },
  facet: {
    term: 'Facet',
    text: 'A boundary piece one dimension lower than the shape itself: the edges of a polygon, the faces of a polyhedron, the cells of a 4D polytope.',
  },
  regular: {
    term: 'Regular polytope',
    text: 'A polytope where every face, edge and vertex looks the same as every other. 3D has five (the Platonic solids); 4D has six; every higher dimension has only three.',
  },
  dual: {
    term: 'Dual',
    text: 'Put a vertex at the center of each facet and connect neighbours: that is the dual. Cube ↔ octahedron, tesseract ↔ 16-cell, 120-cell ↔ 600-cell. The 24-cell is its own dual.',
  },
  schlafli: {
    term: 'Schläfli symbol',
    text: 'A compact name for a regular polytope. {p} is a p-sided polygon; {p,q} has q of those polygons around each vertex; {4,3,3} is the tesseract.',
  },
  projection: {
    term: 'Projection',
    text: 'Flattening a shape onto fewer dimensions, like a shadow. Unlike a slice it shows the whole shape at once, squashed. The context view uses projections to show where the slice cuts.',
  },
  circumradius: {
    term: 'Circumradius',
    text: 'The distance from a polytope’s center to its vertices: the radius of the smallest ball around the center that contains it.',
  },
  keyframe: {
    term: 'Keyframe',
    text: 'A value pinned to a moment in time. Playback blends smoothly between keyframes. Click a ◆ next to any number to keyframe it at the playhead.',
  },
  isoclinic: {
    term: 'Double rotation',
    text: 'Rotating in two completely perpendicular planes at once, like xy and zw. At equal speeds (an isoclinic rotation) every point travels along a circle at the same rate. There is no axis that stays still, which has no 3D equivalent.',
  },
  flatland: {
    term: 'Flatland',
    text: 'Edwin Abbott’s 1884 story about 2D beings. Flatland mode is our warm-up analogy, one dimension down: 3D shapes sliced by a 2D plane.',
  },
  shading4d: {
    term: '4D tilt shading',
    text: 'Colours the surface by how much it faces into the hidden direction: orange where the 4D surface tilts towards +w, blue towards −w, grey where it faces straight along our world.',
  },
  depthShading: {
    term: 'Hidden-depth shading',
    text: 'Colours each point by where it sits inside the shape along the hidden axis in the shape’s own coordinates: blue for −w, orange for +w.',
  },
  cellShading: {
    term: 'Cell shading',
    text: 'Gives every cell (3D boundary piece) of the 4D polytope its own colour, so you can see which cells the slice is cutting through.',
  },
};

export type GlossaryKey = keyof typeof GLOSSARY;
