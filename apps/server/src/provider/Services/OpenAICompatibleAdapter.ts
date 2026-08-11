/**
 * OpenAICompatibleAdapter - Service tag for host-owned BYOK OpenAI-compatible chat.
 *
 * @module OpenAICompatibleAdapter
 */
import { ServiceMap } from "effect";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface OpenAICompatibleAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: "openaiCompatible";
}

export class OpenAICompatibleAdapter extends ServiceMap.Service<
  OpenAICompatibleAdapter,
  OpenAICompatibleAdapterShape
>()("synara/provider/Services/OpenAICompatibleAdapter") {}
