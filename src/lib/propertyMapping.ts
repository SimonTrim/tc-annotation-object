/**
 * Mappings between raw API field names and user-facing French labels.
 * Used by both extractProperties (useAnnotations) and buildAnnotationText (annotationEngine).
 */

export const REF_GROUP = "Référence Objet";
export const IDENTITY_GROUP = "Identité";

/** Top-level object fields → "Référence Objet" group */
export const TOP_LEVEL_LABELS: Record<string, string> = {
  class: "Type commun",
  globalId: "GUID (IFC)",
  guid: "GUID (MS)",
  fileFormat: "Format de fichier",
  fileName: "Nom du fichier",
  layer: "Couche",
  presentationLayerAssignment: "Couche de présentation",
};

/** Fields to skip when scanning top-level object properties */
export const SKIP_TOP_LEVEL = new Set([
  "id",
  "runtimeId",
  "product",
  "properties",
  "position",
  "color",
  "boundingBox",
]);

/** Product sub-object fields → "Identité" group */
export const PRODUCT_LABELS: Record<string, string> = {
  name: "Nom",
  description: "Description",
  objectType: "Type d'objet",
  state: "État",
  changeAction: "Action de changement",
  creationDate: "Date de création",
  lastModificationDate: "Dernière modification",
  applicationIdentifier: "ID Application",
  applicationFullName: "Application",
  applicationVersion: "Version application",
  organizationId: "ID Organisation",
  organizationName: "Organisation",
  organizationDescription: "Description organisation",
  organizationRoles: "Rôles organisation",
  personId: "ID Personne",
  personFamilyName: "Auteur (nom)",
  personGivenName: "Auteur (prénom)",
  personRoles: "Rôles personne",
  personMiddleNames: "Seconds prénoms",
};

/** Reverse-lookup: find raw field name from display label */
export function findFieldByLabel(
  labelMap: Record<string, string>,
  label: string,
): string | undefined {
  return Object.entries(labelMap).find(([, v]) => v === label)?.[0];
}
