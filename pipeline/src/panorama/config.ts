export const DEFAULT_PANORAMA_CONFIG = {
  source: {
    width: 5504,
    height: 3072,
  },
  generation: {
    aspectRatio: "16:9",
    imageSize: "4K",
    thinkingLevel: "HIGH",
  },
  delivery: {
    width: 8192,
    height: 4096,
  },
  seamFeatherWidth: 64,
} as const;

export type PanoramaProcessingConfig = {
  sourceWidth: number;
  sourceHeight: number;
  deliveryWidth: number;
  deliveryHeight: number;
  seamFeatherWidth: number;
};

export function defaultProcessingConfig(): PanoramaProcessingConfig {
  return {
    sourceWidth: DEFAULT_PANORAMA_CONFIG.source.width,
    sourceHeight: DEFAULT_PANORAMA_CONFIG.source.height,
    deliveryWidth: DEFAULT_PANORAMA_CONFIG.delivery.width,
    deliveryHeight: DEFAULT_PANORAMA_CONFIG.delivery.height,
    seamFeatherWidth: DEFAULT_PANORAMA_CONFIG.seamFeatherWidth,
  };
}
