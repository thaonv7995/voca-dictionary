export function extractLlmResponseText(data: any): string {
  if (!data) return "";

  // 1. Antigravity / Gemini output_text field
  if (data.output_text) {
    return String(data.output_text);
  }

  // 2. Antigravity / Gemini output field (array of contents or plain string)
  if (data.output) {
    if (Array.isArray(data.output)) {
      return data.output
        .flatMap((item: any) => item.content || [])
        .map((content: any) => content.text || "")
        .join("");
    }
    return String(data.output);
  }

  // 3. OpenAI choices message content
  if (data.choices?.[0]?.message?.content !== undefined) {
    return String(data.choices[0].message.content);
  }

  // 4. Anthropic / Other providers standard text field
  if (data.text) {
    return String(data.text);
  }

  // 5. Ollama / LlamaCPP response field
  if (data.response) {
    return String(data.response);
  }

  // 6. Direct message content fallback
  if (data.message?.content) {
    return String(data.message.content);
  }

  return "";
}

export function extractLlmDeltaText(chunk: any): string {
  if (!chunk) return "";

  // 1. OpenAI delta choices content
  if (chunk.choices?.[0]?.delta?.content !== undefined) {
    return String(chunk.choices[0].delta.content);
  }

  // 2. Antigravity / Gemini output_text field
  if (chunk.output_text) {
    return String(chunk.output_text);
  }

  // 3. Antigravity / Gemini output field (array of contents or plain string)
  if (chunk.output) {
    if (Array.isArray(chunk.output)) {
      return chunk.output
        .flatMap((item: any) => item.content || [])
        .map((content: any) => content.text || "")
        .join("");
    }
    return String(chunk.output);
  }

  // 4. Anthropic / Other providers standard text field
  if (chunk.text) {
    return String(chunk.text);
  }

  // 5. Ollama / LlamaCPP response field
  if (chunk.response) {
    return String(chunk.response);
  }

  // 6. Direct delta content
  if (chunk.delta?.content) {
    return String(chunk.delta.content);
  }

  return "";
}
