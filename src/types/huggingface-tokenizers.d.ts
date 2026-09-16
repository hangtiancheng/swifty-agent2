declare module "@huggingface/tokenizers" {
  export interface Encoding {
    ids: number[];
    attention_mask: number[];
    token_type_ids?: number[];
  }

  export interface EncodeOptions {
    add_special_tokens?: boolean;
    return_token_type_ids?: boolean;
  }

  export class Tokenizer {
    constructor(tokenizer: object, config?: object);
    encode(text: string, options?: EncodeOptions): Encoding;
  }
}
