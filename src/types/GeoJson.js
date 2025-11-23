// backend/src/types/GeoJson.ts


/**
 * Defines the GeoJSON Polygon geometry type for use in backend models.
 * Coordinates are [longitude, latitude].
 * @typedef {Object} GeoJsonPolygon
 * @property {'Polygon'} type
 * @property {number[][][]} coordinates
 */

/**
 * A simplified interface for a GeoJSON Feature object.
 * @typedef {Object} GeoJsonFeature
 * @property {'Feature'} type
 * @property {GeoJsonPolygon} geometry
 * @property {Record<string, any>} properties
 */
