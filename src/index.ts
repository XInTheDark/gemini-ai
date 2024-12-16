import { Command, HarmCategory, SafetyThreshold, SchemaType, isFileUpload, Model, OpenAIMessage } from "./types";

import type {
  ChatAskOptions,
  ChatOptions,
  CommandOptionMap,
  CommandResponseMap,
  Format,
  GeminiOptions,
  GeminiResponse,
  GeminiResponseStream,
  GenerateContentOutput,
  FileUpload,
  Message,
  Part,
  QueryBodyMap,
} from "./types";

import { SafetyError, getFileType, pairToMessage } from "./utils";

// Official Gemini SDK
import { GenerateContentResult, GoogleGenerativeAI } from "@google/generative-ai";

// Constants
const BASE_URL = "https://generativelanguage.googleapis.com";

const uploadFile = async ({
  file,
  mimeType,
  gemini,
}: {
  file: Uint8Array | ArrayBuffer;
  mimeType: string;
  gemini: Gemini;
}) => {
  function generateBoundary() {
    let str = "";
    for (let i = 0; i < 2; i++) {
      str = str + Math.random().toString().slice(2);
    }
    return str;
  }

  const boundary = generateBoundary();

  const generateBlob = (boundary: string, file: Uint8Array | ArrayBuffer, mime: string) =>
    new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${JSON.stringify({
        file: {
          mimeType: mime,
        },
      })}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
      file,
      `\r\n--${boundary}--`,
    ]);

  const fileSendDataRaw = await gemini
    .fetch(`${BASE_URL}/upload/${gemini.apiVersion}/files?key=${gemini.key}`, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "X-Goog-Upload-Protocol": "multipart",
      },
      body: generateBlob(boundary, file, mimeType),
    })
    .then((res: Response) => res.json());

  const fileSendData = fileSendDataRaw.file;

  let waitTime = 250; // Initial wait time in milliseconds
  const MAX_BACKOFF = 5000; // Maximum backoff time in milliseconds

  // Keep polling until the file state is "ACTIVE"
  while (true) {
    try {
      const url = `${BASE_URL}/${gemini.apiVersion}/${fileSendData.name}?key=${gemini.key}`;

      const response = await gemini.fetch(url, { method: "GET" });
      const data = await response.json();

      if (data.error) {
        throw new Error(`Google's File API responded with an error: ${data.error.message}`);
      }

      if (data.state === "ACTIVE") break;

      await new Promise((resolve) => setTimeout(resolve, waitTime));

      waitTime = Math.min(waitTime * 1.5, MAX_BACKOFF);
    } catch (error) {
      throw new Error(`An error occurred while uploading to Google's File API: ${error.message}`);
    }
  }

  return fileSendData.uri;
};

export const messageToParts = async (
  messages: (Uint8Array | ArrayBuffer | FileUpload | string)[],
  gemini: Gemini,
): Promise<Part[]> => {
  const parts = [];
  let totalBytes = 0;

  for (const msg of messages) {
    if (typeof msg === "string") {
      parts.push({ text: msg });
    } else if (msg instanceof ArrayBuffer || msg instanceof Uint8Array || isFileUpload(msg)) {
      const is_file_upload = isFileUpload(msg);
      const buffer = is_file_upload ? msg.buffer : msg;
      const filePath = is_file_upload ? msg.filePath : undefined;
      totalBytes += Buffer.from(buffer).byteLength;
      const mimeType = await getFileType(buffer, filePath);
      if (!mimeType.startsWith("video")) {
        parts.push({
          inlineData: {
            mimeType: mimeType,
            data: Buffer.from(buffer).toString("base64"),
          },
        });
      } else {
        const fileURI = await uploadFile({
          file: buffer,
          mimeType: mimeType,
          gemini: gemini,
        });
        parts.push({
          fileData: {
            mimeType: mimeType,
            fileUri: fileURI,
          },
        });
      }
    }
  }

  if (totalBytes > 20 * 1024 * 1024) {
    for (const idx in parts) {
      const part = parts[idx];
      if (part.inline_data) {
        const fileURI = await uploadFile({
          file: Buffer.from(part.inline_data.data, "base64"),
          mimeType: part.inline_data.mime_type,
          gemini: gemini,
        });
        parts[idx] = {
          fileData: {
            mime_type: part.inline_data.mime_type,
            fileUri: fileURI,
          },
        };
      }
    }
  }

  return parts;
};

class Gemini {
  googleGemini: GoogleGenerativeAI;
  readonly key: string;
  readonly apiVersion: string;
  readonly fetch: typeof fetch;

  static TEXT = "text" as const;
  static JSON = "json" as const;
  static SafetyThreshold = SafetyThreshold;
  static SchemaType = SchemaType;

  constructor(key: string, options: Partial<GeminiOptions> = {}) {
    if (!options.fetch && typeof fetch !== "function") {
      throw new Error(
        "Fetch is not defined globally. Please provide a polyfill. Learn more here: https://github.com/EvanZhouDev/gemini-ai?tab=readme-ov-file#how-to-polyfill-fetch",
      );
    }

    const parsedOptions: GeminiOptions = {
      ...{
        apiVersion: "v1beta",
        fetch: typeof fetch === "function" ? fetch : options.fetch,
      },
      ...options,
    };

    this.key = key;
    this.fetch = parsedOptions.fetch;
    this.apiVersion = parsedOptions.apiVersion;

    this.googleGemini = new GoogleGenerativeAI(key);
  }

  private handleStream = async function (response: GeminiResponseStream) {
    return (async function* () {
      for await (const chunk of response.stream) {
        yield chunk;
      }
    })();
  };

  async ask<F extends Format = typeof Gemini.TEXT>(
    message: string | (string | Uint8Array | ArrayBuffer)[] | Message,
    options: Partial<CommandOptionMap<F>[Command.Generate]> = {},
  ): Promise<CommandResponseMap<F>[Command.Generate]> {
    const parsedOptions: CommandOptionMap<F>[Command.Generate] = {
      ...{
        model: "gemini-1.5-flash-latest",
        temperature: 1,
        format: Gemini.TEXT as F,
        maxOutputTokens: 8192,
        data: [],
        messages: [],
        safetySettings: {
          hate: Gemini.SafetyThreshold.BLOCK_NONE,
          sexual: Gemini.SafetyThreshold.BLOCK_NONE,
          harassment: Gemini.SafetyThreshold.BLOCK_NONE,
          dangerous: Gemini.SafetyThreshold.BLOCK_NONE,
        },
        systemInstruction: "",
        jsonSchema: undefined,
      },
      ...options,
    };

    const safetySettings = [
      {
        category: HarmCategory.HateSpeech,
        threshold: parsedOptions.safetySettings.hate,
      },
      {
        category: HarmCategory.SexuallyExplicit,
        threshold: parsedOptions.safetySettings.sexual,
      },
      {
        category: HarmCategory.Harassment,
        threshold: parsedOptions.safetySettings.harassment,
      },
      {
        category: HarmCategory.DangerousContent,
        threshold: parsedOptions.safetySettings.dangerous,
      },
    ];

    const command = parsedOptions.stream ? Command.StreamGenerate : Command.Generate;

    const contents = [
      ...parsedOptions.messages.flatMap((msg: [string, string] | Message) => {
        if (Array.isArray(msg)) {
          return pairToMessage(msg);
        }
        return msg;
      }),
    ];

    let lastMessage;
    if (!Array.isArray(message) && typeof message !== "string") {
      if (message.role === "model") throw new Error("Please prompt with role as 'user'");
      lastMessage = message;
    } else {
      const messageParts = [message, parsedOptions.data].flat();
      const parts = await messageToParts(messageParts, this);

      lastMessage = {
        parts: parts,
        role: "user",
      };
    }

    const body: QueryBodyMap[typeof command] = {
      contents,
      generationConfig: {
        temperature: parsedOptions.temperature,
        maxOutputTokens: parsedOptions.maxOutputTokens,
        topP: parsedOptions.topP,
        topK: parsedOptions.topK,
        responseMimeType: parsedOptions.jsonSchema ? "application/json" : undefined,
        responseSchema: parsedOptions.jsonSchema,
      },
      safetySettings,
    };

    if (parsedOptions.systemInstruction !== "") {
      body.systemInstruction = {
        parts: [{ text: parsedOptions.systemInstruction }],
        role: "system",
      };
    }

    const googleGemini = this.googleGemini;
    const model = parsedOptions.model;

    let iter_models =
      model instanceof Array
        ? model
        : model === "auto"
          ? ["gemini-1.5-pro-latest", "gemini-1.5-flash-latest"]
          : [model];

    for (let model_idx = 0; model_idx < iter_models.length; model_idx++) {
      const model = iter_models[model_idx];
      const gemini = googleGemini.getGenerativeModel({ model: model });
      const geminiChat = gemini.startChat({
        // @ts-ignore
        history: contents,
      });

      let response;
      try {
        if (parsedOptions.stream) {
          response = await geminiChat.sendMessageStream(lastMessage);
          return this.handleStream(response);
        } else {
          let streamResponse = await geminiChat.sendMessage(lastMessage);
          response = streamResponse.response.text();
          return response;
        }
      } catch (e) {
        if (model_idx === iter_models.length - 1) {
          throw e;
        }
      }
    }
  }

  createChat(options: Partial<ChatOptions> = {}) {
    return new Chat(this, options);
  }
}

class Chat {
  gemini: Gemini;
  options: ChatOptions;
  messages: Message[];

  constructor(gemini: Gemini, options?: Partial<ChatOptions>) {
    const parsedOptions: ChatOptions = {
      ...{
        messages: [],
        temperature: 1,
        model: "gemini-1.5-flash-latest",
        maxOutputTokens: 8192,
        systemInstruction: "",
      },
      ...options,
    };

    this.gemini = gemini;
    this.options = parsedOptions;

    if (parsedOptions.messages[0] && Array.isArray(parsedOptions.messages[0])) {
      // @ts-ignore It is ensured that parsedOptions.messages is [string, string][] with the above check.
      this.messages = parsedOptions.messages.flatMap(pairToMessage);
    } else {
      this.messages = parsedOptions.messages as Message[];
    }
  }

  append(message: string | OpenAIMessage) {
    if (typeof message === "string") {
      this.messages.push({
        parts: [{ text: message }],
        role: this.messages.at(-1)?.role === "model" ? "user" : "model",
      });
    } else {
      this.messages.push({ role: message.role, parts: [{ text: message.content }] });
    }
  }

  async ask<F extends Format = typeof Gemini.TEXT>(
    message: string | (string | Uint8Array | ArrayBuffer)[] | Message,
    options: Partial<ChatAskOptions<F>> = {},
  ): Promise<CommandResponseMap<F>[Command.Generate]> {
    const parsedConfig: CommandOptionMap<F>[Command.Generate] = {
      ...{
        data: [],
        format: Gemini.TEXT as F,
        safetySettings: {
          hate: Gemini.SafetyThreshold.BLOCK_SOME,
          sexual: Gemini.SafetyThreshold.BLOCK_SOME,
          harassment: Gemini.SafetyThreshold.BLOCK_SOME,
          dangerous: Gemini.SafetyThreshold.BLOCK_SOME,
        },
        systemInstruction: "",
        jsonSchema: undefined,
      },
      ...this.options,
      ...options,
    };

    if (this.messages.at(-1)?.role === "user") {
      throw new Error(
        "Gemini has not yet responded to your last message. Please ensure you are running chat commands asynchronously.",
      );
    }

    let parsedMessage: Message;
    if (!Array.isArray(message) && typeof message !== "string") {
      if (message.role === "model") throw new Error("Please prompt with role as 'user'");
      parsedMessage = message;
    } else {
      parsedMessage = {
        parts: await messageToParts([message].flat(), this.gemini),
        role: "user",
      };
    }

    const response = await this.gemini.ask(parsedMessage, {
      ...parsedConfig,
      format: Gemini.TEXT,
      messages: this.messages,
      stream: parsedConfig.stream,
    });

    // this.messages.push(parsedMessage);
    // if (typeof response === "string") {
    //   this.messages.push({
    //     parts: [{text: response}],
    //     role: "model",
    //   });
    // }
    // else {
    //   // handling the async generator is kinda confusing
    // }

    // return options.format === Gemini.JSON
    // 	? (response as FormatType<F>)
    // 	: (response.candidates[0].content.parts[0].text as FormatType<F>);
    return response;
  }
}

export default Gemini;

export type { Format, Message, Part, CommandResponseMap, CommandOptionMap, GeminiOptions, ChatOptions, ChatAskOptions };
