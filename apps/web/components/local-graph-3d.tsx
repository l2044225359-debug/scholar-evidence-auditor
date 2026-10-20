"use client";

import ForceGraph3D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-3d";
import {
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OctahedronGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  SphereGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  type Object3D,
} from "three";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type PaperNode = {
  id: string;
  title: string;
  pagerank: number;
  in_degree: number;
  out_degree: number;
};

type CitationEdge = {
  source: string;
  target: string;
  relation: string;
};

type EntityNode = {
  id: string;
  type:
    | "paper"
    | "author"
    | "topic"
    | "method"
    | "dataset"
    | "metric"
    | "claim";
  label: string;
  paper_ids: string[];
};

type EntityEdge = {
  source: string;
  target: string;
  relation: string;
  evidence: string;
  confidence: number;
};

type GraphNode = {
  id: string;
  label: string;
  kind: EntityNode["type"];
  paperId: string;
  pagerank: number;
  degree: number;
  color: string;
  x?: number;
  y?: number;
  z?: number;
};

type GraphLink = {
  id: string;
  source: string;
  target: string;
  kind: "citation" | "entity";
  relation: string;
  evidence?: string;
  confidence?: number;
};

export type LocalGraph3DProps = {
  papers: PaperNode[];
  citationEdges: CitationEdge[];
  entityNodes: EntityNode[];
  entityEdges: EntityEdge[];
  selectedPaperId?: string;
  selectedEntityId?: string;
  visibleTypes: Set<EntityNode["type"]>;
  autoRotate: boolean;
  fitVersion: number;
  onSelectPaper: (paperId: string) => void;
  onSelectEntity: (entityId: string, paperId?: string) => void;
};

const TYPE_COLORS: Record<EntityNode["type"], string> = {
  paper: "#496fd8",
  author: "#788a9f",
  topic: "#2f8c83",
  method: "#82bd45",
  dataset: "#b18439",
  metric: "#b35d76",
  claim: "#ba6255",
};

const TYPE_SIZES: Record<EntityNode["type"], number> = {
  paper: 4.2,
  author: 1.9,
  topic: 2.4,
  method: 2.2,
  dataset: 2.0,
  metric: 1.8,
  claim: 1.8,
};

const materials = new Map<string, MeshLambertMaterial>();
const glowMaterials = new Map<string, MeshBasicMaterial>();
const labelTextures = new Map<string, CanvasTexture>();
const geometries = {
  paper: new SphereGeometry(0.64, 18, 18),
  author: new SphereGeometry(0.62, 10, 10),
  topic: new OctahedronGeometry(0.72),
  method: new TetrahedronGeometry(0.78),
  dataset: new CylinderGeometry(0.55, 0.55, 1, 10),
  metric: new TorusGeometry(0.52, 0.16, 8, 18),
  claim: new ConeGeometry(0.58, 1, 8),
};

function materialFor(color: string) {
  const cached = materials.get(color);
  if (cached) return cached;
  const material = new MeshLambertMaterial({
    color: new Color(color),
    transparent: true,
    opacity: 0.96,
  });
  materials.set(color, material);
  return material;
}

function glowMaterialFor(color: string) {
  const cached = glowMaterials.get(color);
  if (cached) return cached;
  const material = new MeshBasicMaterial({
    color: new Color(color),
    transparent: true,
    opacity: 0.13,
    depthWrite: false,
  });
  glowMaterials.set(color, material);
  return material;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function nodeSize(node: GraphNode) {
  if (node.kind === "paper") {
    return TYPE_SIZES.paper + Math.min(2.2, node.degree * 0.08);
  }
  return TYPE_SIZES[node.kind];
}

function createLabelSprite(text: string, selected: boolean) {
  const cacheKey = `${selected ? "selected" : "paper"}:${text}`;
  const cachedTexture = labelTextures.get(cacheKey);
  if (cachedTexture) {
    const sprite = new Sprite(
      new SpriteMaterial({
        map: cachedTexture,
        transparent: true,
        depthWrite: false,
      }),
    );
    const labelWidth = Math.min(34, 9 + text.length * 0.58);
    sprite.scale.set(labelWidth, labelWidth * (128 / 768), 1);
    return sprite;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font =
    '600 38px "Microsoft YaHei", "Segoe UI", sans-serif';
  const label = text.length > 42 ? `${text.slice(0, 42)}…` : text;
  const width = Math.min(730, context.measureText(label).width + 34);
  context.fillStyle = selected
    ? "rgba(168, 71, 50, 0.94)"
    : "rgba(248, 249, 245, 0.92)";
  context.fillRect(9, 31, width, 58);
  context.strokeStyle = selected ? "#8f3726" : "#aab8b4";
  context.lineWidth = 2;
  context.strokeRect(9, 31, width, 58);
  context.fillStyle = selected ? "#ffffff" : "#172326";
  context.textBaseline = "middle";
  context.fillText(label, 25, 61);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  labelTextures.set(cacheKey, texture);
  const sprite = new Sprite(
    new SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    }),
  );
  const spriteWidth = Math.min(34, 9 + label.length * 0.58);
  sprite.scale.set(spriteWidth, spriteWidth * (128 / 768), 1);
  return sprite;
}

function normalizePaperId(value: string) {
  return value.startsWith("paper:") ? value.slice("paper:".length) : value;
}

function endpointId(
  value: string | number | NodeObject<GraphNode> | undefined,
) {
  if (value && typeof value === "object") {
    return String(value.id ?? "");
  }
  return String(value ?? "");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export default function LocalGraph3D({
  papers,
  citationEdges,
  entityNodes,
  entityEdges,
  selectedPaperId,
  selectedEntityId,
  visibleTypes,
  autoRotate,
  fitVersion,
  onSelectPaper,
  onSelectEntity,
}: LocalGraph3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef =
    useRef<
      ForceGraphMethods<
        NodeObject<GraphNode>,
        LinkObject<GraphNode, GraphLink>
      >
    >(undefined);
  const [size, setSize] = useState({ width: 900, height: 620 });
  const [webglError, setWebglError] = useState("");

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(320, Math.round(entry.contentRect.width));
      const height = Math.max(420, Math.round(entry.contentRect.height));
      setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = document.createElement("canvas");
    if (!canvas.getContext("webgl2") && !canvas.getContext("webgl")) {
      setWebglError("3D graph requires WebGL.");
    }
  }, []);

  const graphData = useMemo(() => {
    const nodes: GraphNode[] = [];
    const nodeIds = new Set<string>();
    const paperPositions = new Map<
      string,
      { x: number; y: number; z: number }
    >();
    papers.forEach((paper, index) => {
      const angle =
        (Math.PI * 2 * index) / Math.max(1, papers.length) - Math.PI / 2;
      paperPositions.set(paper.id, {
        x: Math.cos(angle) * 92,
        y: Math.sin(index * 1.7) * 18,
        z: Math.sin(angle) * 92,
      });
    });
    for (const paper of papers) {
      if (!visibleTypes.has("paper")) continue;
      const position = paperPositions.get(paper.id);
      nodes.push({
        id: paper.id,
        label: paper.title,
        kind: "paper",
        paperId: paper.id,
        pagerank: paper.pagerank,
        degree: paper.in_degree + paper.out_degree,
        color: TYPE_COLORS.paper,
        x: position?.x,
        y: position?.y,
        z: position?.z,
      });
      nodeIds.add(paper.id);
    }
    for (const entity of entityNodes) {
      if (
        entity.type === "paper" ||
        !visibleTypes.has(entity.type) ||
        !entity.paper_ids.length
      ) {
        continue;
      }
      const alreadyPresent = entity.paper_ids.some((paperId) =>
        nodeIds.has(paperId),
      );
      if (!alreadyPresent) continue;
      const base = paperPositions.get(entity.paper_ids[0]);
      const hash = hashString(entity.id);
      nodes.push({
        id: entity.id,
        label: entity.label,
        kind: entity.type,
        paperId: entity.paper_ids[0] ?? "",
        pagerank: 0,
        degree: 0,
        color: TYPE_COLORS[entity.type],
        x: (base?.x ?? 0) + ((hash % 31) - 15),
        y:
          (base?.y ?? 0) +
          (((Math.floor(hash / 31) % 17) - 8) * 0.9),
        z: (base?.z ?? 0) + ((Math.floor(hash / 527) % 31) - 15),
      });
      nodeIds.add(entity.id);
    }

    const links: GraphLink[] = [];
    for (const edge of citationEdges) {
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
      links.push({
        id: `cites:${edge.source}:${edge.target}`,
        source: edge.source,
        target: edge.target,
        kind: "citation",
        relation: "cites",
      });
    }
    for (const edge of entityEdges) {
      const source = normalizePaperId(edge.source);
      const target = normalizePaperId(edge.target);
      if (!nodeIds.has(source) || !nodeIds.has(target)) continue;
      links.push({
        id: `entity:${edge.source}:${edge.target}:${edge.relation}`,
        source,
        target,
        kind: "entity",
        relation: edge.relation,
        evidence: edge.evidence,
        confidence: edge.confidence,
      });
    }
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    for (const link of links) {
      const source = nodesById.get(String(link.source));
      const target = nodesById.get(String(link.target));
      if (source) source.degree += 1;
      if (target) target.degree += 1;
    }
    return { nodes, links };
  }, [citationEdges, entityEdges, entityNodes, papers, visibleTypes]);

  useEffect(() => {
    const controls = graphRef.current?.controls() as
      | { autoRotate?: boolean; autoRotateSpeed?: number }
      | undefined;
    if (!controls) return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    controls.autoRotate = autoRotate && !reducedMotion;
    controls.autoRotateSpeed = 0.28;
  }, [autoRotate, graphData]);

  useEffect(() => {
    if (fitVersion <= 0) return;
    const timeout = window.setTimeout(() => {
      graphRef.current?.zoomToFit(
        550,
        42,
        (node) => Number(node.degree ?? 0) > 0,
      );
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [fitVersion]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const charge = graphRef.current?.d3Force("charge") as
        | { strength?: (value: number) => void }
        | undefined;
      charge?.strength?.(-24);
      const link = graphRef.current?.d3Force("link") as
        | {
            distance?: (
              value: (link: LinkObject<GraphNode, GraphLink>) => number,
            ) => void;
          }
        | undefined;
      link?.distance?.((edge) =>
        edge.kind === "citation" ? 54 : 25,
      );
      graphRef.current?.d3ReheatSimulation();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [graphData]);

  useEffect(() => {
    const targetId = selectedEntityId || selectedPaperId;
    if (!targetId) return;
    const node = graphData.nodes.find((item) => item.id === targetId);
    if (!node) return;
    const current = node as NodeObject<GraphNode>;
    if (
      current.x == null ||
      current.y == null ||
      current.z == null
    ) {
      return;
    }
    const distance = 72;
    const ratio = 1 + distance / Math.hypot(current.x, current.y, current.z);
    graphRef.current?.cameraPosition(
      {
        x: current.x * ratio,
        y: current.y * ratio,
        z: current.z * ratio,
      },
      { x: current.x, y: current.y, z: current.z },
      650,
    );
  }, [graphData.nodes, selectedEntityId, selectedPaperId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      graphRef.current?.refresh();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [selectedEntityId, selectedPaperId]);

  if (webglError) {
    return <div className="graph3d-error">{webglError}</div>;
  }

  return (
    <div
      className="graph3d-canvas"
      ref={containerRef}
      role="application"
      aria-label="三维论文实体关系图。可拖拽旋转、滚轮缩放，点击节点查看论文或实体证据。"
      tabIndex={0}
    >
      <ForceGraph3D<GraphNode, GraphLink>
        ref={graphRef}
        graphData={graphData}
        width={size.width}
        height={size.height}
        backgroundColor="#ffffff"
        showNavInfo={false}
        nodeRelSize={1}
        nodeVal={(node) => nodeSize(node)}
        nodeLabel={(node) =>
          `<div class="graph3d-tooltip"><b>${escapeHtml(node.label)}</b>` +
          `<span>${escapeHtml(node.kind)}</span></div>`
        }
        nodeThreeObject={(node: GraphNode): Object3D => {
          const selected =
            node.id === selectedEntityId || node.id === selectedPaperId;
          const radius = nodeSize(node);
          const group = new Group();
          const glow = new Mesh(
            geometries[node.kind],
            glowMaterialFor(selected ? "#a84732" : node.color),
          );
          glow.scale.setScalar(radius * 2.15);
          const mesh = new Mesh(
            geometries[node.kind],
            materialFor(selected ? "#a84732" : node.color),
          );
          mesh.scale.setScalar(radius * (selected ? 1.18 : 1));
          mesh.userData.graphNode = node;
          group.add(glow, mesh);
          if (node.kind === "paper" || selected) {
            const label = createLabelSprite(node.label, selected);
            if (label) {
              label.position.set(0, radius + 2.4, 0);
              group.add(label);
            }
          }
          return group;
        }}
        linkColor={(link) => {
          if (selectedPaperId || selectedEntityId) {
            const source = endpointId(link.source);
            const target = endpointId(link.target);
            const selected = selectedEntityId || selectedPaperId;
            if (source !== selected && target !== selected) {
              return "#e4e9e7";
            }
          }
          return link.kind === "citation" ? "#b7c4c8" : "#d4dcda";
        }}
        linkWidth={(link) => (link.kind === "citation" ? 0.9 : 0.45)}
        linkOpacity={0.42}
        linkDirectionalArrowLength={(link) =>
          link.kind === "citation" ? 2.2 : 0
        }
        linkDirectionalArrowRelPos={1}
        linkDirectionalArrowColor={() => "#9aabae"}
        linkLabel={(link) =>
          `<div class="graph3d-tooltip"><b>${escapeHtml(link.relation)}</b>` +
          (link.evidence
            ? `<span>${escapeHtml(link.evidence.slice(0, 220))}</span>`
            : "") +
          "</div>"
        }
        onNodeClick={(node) => {
          if (node.kind === "paper") {
            onSelectPaper(node.paperId);
          } else {
            onSelectEntity(node.id, node.paperId);
          }
        }}
        onEngineStop={() =>
          graphRef.current?.zoomToFit(
            450,
            40,
            (node) => Number(node.degree ?? 0) > 0,
          )
        }
        cooldownTicks={100}
        warmupTicks={30}
        d3AlphaDecay={0.035}
        d3VelocityDecay={0.28}
        enableNodeDrag
        enableNavigationControls
      />
    </div>
  );
}
