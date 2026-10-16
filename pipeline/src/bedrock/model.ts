// Source-bearing text stages use an Amazon-operated model through AWS Bedrock.
export const AMAZON_NOVA_TEXT_MODEL = "amazon.nova-lite-v1:0";

export function assertAmazonNovaTextModel(model: string): void {
  if (model !== AMAZON_NOVA_TEXT_MODEL) {
    throw new Error(`Source-bearing text stages permit only the Amazon-operated model ${AMAZON_NOVA_TEXT_MODEL}`);
  }
}
