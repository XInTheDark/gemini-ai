import { FileTypeResult, fileTypeFromBuffer } from "file-type";
import type { GeminiResponse, Message } from "./types";
import { getType } from "mime-lite";

const validMediaFormats = [
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
];

const formatMap = {
	"audio/mpeg": "audio/mp3",
	"video/quicktime": "video/mov",
};

export const getFileType = async (buffer: Uint8Array | ArrayBuffer, filePath: string | undefined = undefined, strict: boolean = false) => {
	const fileType: FileTypeResult | undefined = await fileTypeFromBuffer(buffer);

	let format = formatMap[fileType?.mime as string] || fileType?.mime;
	let valid = validMediaFormats.includes(format);

	if (!valid && filePath) {
		// If the format cannot be detected, we fall back to using the file extension instead.
		format = getType(filePath);
		format = formatMap[format] || format;
		valid = validMediaFormats.includes(format);
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

export const handleReader = async (
	response: Response,
	cb: (response: GeminiResponse) => void,
) => {
	if (!response.body)
		throw new Error(
			`An error occurred when attempting to read Gemini's response ${await response.text()}`,
		);

	const decoder = new TextDecoder("utf-8");

	try {
		// This solution breaks on Safari or any fetch polyfill without AsyncIterators, but it works for node-fetch.
		// response.body has an asyncIterator in modern most browsers
		// @ts-ignore
		for await (const chunk of response.body) {
			cb(JSON.parse(decoder.decode(chunk).replace(/^data: /, "")));
		}
	}
	catch (e) {
		if (e instanceof SafetyError) throw e;

		try {
			// This solution works for nearly every fetch, except for the node-fetch polyfill.
			const reader = response.body.getReader();

			await reader.read().then(function processText({done, value}) {
				if (done) return;

				cb(JSON.parse(decoder.decode(value).replace(/^data: /, "")));

				return reader.read().then(processText);
			});
		}
		catch (err) {
			if (err instanceof SafetyError) throw err;
			throw new Error(
				`An error occurred when attempting to stream content from Gemini: ${err.stack}`,
			);
		}
	}
};

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
