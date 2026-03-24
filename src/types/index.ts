// ── Workspace API (chargé via CDN) ──

export interface TrimbleAPI {
  project: {
    getCurrentProject: () => Promise<ConnectProject>;
  };
  extension: {
    requestPermission: (permission: string) => Promise<string>;
    setStatusMessage: (msg: string) => void;
  };
  viewer: {
    getModels: (filter?: string) => Promise<ModelSpec[]>;
    getSelection: () => Promise<ViewerSelection[]>;
    setSelection: (selector: unknown, mode: string) => Promise<void>;
    getObjectProperties: (
      modelId: string,
      ids: number[],
    ) => Promise<ObjectProperties[]>;
    getObjectBoundingBoxes: (
      modelId: string,
      ids: number[],
    ) => Promise<ObjectBoundingBox[]>;
    addIcon: (icon: PointIcon | PointIcon[]) => Promise<void>;
    removeIcon: (icon?: PointIcon | PointIcon[]) => Promise<void>;
    getIcon: () => Promise<PointIcon[]>;
    setObjectState: (selector: unknown, state: unknown) => Promise<void>;
    convertToObjectIds: (
      modelId: string,
      ids: number[],
    ) => Promise<string[]>;
  };
  markup: {
    addTextMarkup: (markups: TextMarkup[]) => Promise<TextMarkup[]>;
    removeMarkups: (ids?: number[]) => Promise<void>;
    getTextMarkups: () => Promise<TextMarkup[]>;
  };
  ui: {
    setMenu: (config: unknown) => void;
  };
}

declare global {
  interface Window {
    TrimbleConnectWorkspace: {
      connect: (
        target: Window | HTMLIFrameElement,
        onEvent: (event: string, data: unknown) => void,
        timeout?: number,
      ) => Promise<TrimbleAPI>;
    };
  }
}

// ── Projet & Utilisateur ──

export interface ConnectProject {
  id: string;
  name: string;
  location: string;
  rootId?: string;
}

// ── Modèles ──

export interface ModelSpec {
  id: string;
  name?: string;
  versionId?: string;
  state?: string;
}

// ── Sélection Viewer ──

export interface ViewerSelection {
  modelId: string;
  objectRuntimeIds: number[];
}

// ── Propriétés d'objets ──

export interface ObjectProperties {
  id: number;
  class?: string;
  color?: string;
  position?: Vector3;
  product?: Product;
  properties?: PropertySet[];
}

export interface Product {
  name?: string;
  description?: string;
  objectType?: string;
}

export interface PropertySet {
  set?: string;
  properties?: Property[];
}

export interface Property {
  name: string;
  value: string | number;
  type?: string;
}

// ── Géométrie ──

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface ObjectBoundingBox {
  runtimeId: number;
  min: Vector3;
  max: Vector3;
}

// ── Icônes 3D ──

export interface PointIcon {
  id: number;
  iconPath: string;
  position: Vector3;
  size: number;
}

// ── Markups ──

export interface MarkupPick {
  positionX: number;
  positionY: number;
  positionZ: number;
  modelId?: string;
  objectId?: number;
}

export interface ColorRGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface TextMarkup {
  id?: number;
  text?: string;
  start: MarkupPick;
  end: MarkupPick;
  color?: ColorRGBA;
}

// ── App State ──

export interface AnnotationSettings {
  color: string;
  separator: string;
  horizontal: boolean;
  showUnits: boolean;
  maxObjects: number;
}

export interface PropertyToggleState {
  /** Clé unique: "PropertySetName::PropertyName" */
  key: string;
  propertySet: string;
  propertyName: string;
  enabled: boolean;
}

export interface AnnotatedObject {
  modelId: string;
  runtimeId: number;
  markupIds: number[];
  iconId: number;
  properties: ObjectProperties;
}

export type SortMode = "pset" | "alpha-asc" | "alpha-desc";
