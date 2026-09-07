import type { CheerioAPI } from "cheerio";

// Типы берутся из публичного API Cheerio: нормализаторы не зависят от его внутреннего DOM-пакета.
export type HtmlSelection = ReturnType<CheerioAPI>;
export type HtmlNode = HtmlSelection[number];
export type HtmlElements = ReturnType<HtmlSelection["children"]>;
