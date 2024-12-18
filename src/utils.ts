import { FileTypeResult, fileTypeFromBuffer } from "file-type";
import type { GeminiResponse, Message } from "./types";
import mime from "mime-lite";

const supportedFileFormats = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
  "audio/wav",
  "audio/mp3",
  "audio/mpeg",
  "audio/aiff",
  "audio/aac",
  "audio/ogg",
  "audio/flac",
  "video/mp4",
  "video/mpeg",
  "video/mov",
  "video/avi",
  "video/x-flv",
  "video/mpg",
  "video/webm",
  "video/wmv",
  "video/3gpp",
  "text/plain",
  "text/html",
  "text/css",
  "text/javascript",
  "application/x-javascript",
  "text/x-typescript",
  "application/x-typescript",
  "text/csv",
  "text/markdown",
  "text/x-python",
  "application/x-python-code",
  "application/json",
  "text/xml",
  "application/rtf",
  "text/rtf",
  "application/pdf",
];

const formatMap = {
  "audio/mpeg": "audio/mp3",
  "video/quicktime": "video/mov",
};

export const getFileType = async (
  buffer: Uint8Array | ArrayBuffer,
  filePath: string | undefined = undefined,
  { strict = false } = {},
) => {
  const fileType: FileTypeResult | undefined = await fileTypeFromBuffer(buffer);

  let format = formatMap[fileType?.mime as string] || fileType?.mime;
  let valid = supportedFileFormats.includes(format);

  if (!valid && filePath) {
    // If the format cannot be detected, we fall back to using the file extension instead.
    format = mime.getType(filePath);
    format = formatMap[format] || format;
  }
  if (!valid) {
    if (strict) {
      throw new Error(
        "Please provide a valid file format that is accepted by Gemini. Learn more about valid formats here: https://ai.google.dev/gemini-api/docs/prompting_with_media?lang=node#supported_file_formats",
      );
    } else {
      // if the format is not valid, we default to text/plain
      format = "text/plain";
    }
  }

  return format;
};

export class SafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafetyError";
  }
}

export const pairToMessage = (message: [string, string]): Message[] => {
  return [
    {
      parts: [{ text: message[0] }],
      role: "user",
    },
    {
      parts: [{ text: message[1] }],
      role: "model",
    },
  ];
};

export const convertMessages = (messages: ([string, string] | Message)[]): Message[] => {
  console.log("before: ", messages);
  let convertedMessages: Message[] = [];
  for (let message of messages) {
    if (Array.isArray(message)) {
      convertedMessages = [...convertedMessages, ...pairToMessage(message)];
    } else {
      convertedMessages.push(message);
    }
  }
  console.log("after: ", convertedMessages);
  return convertedMessages;
};
