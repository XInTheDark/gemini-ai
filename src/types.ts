import { ProxyAgent } from "undici";

type FileType =
	| "image/png"
	| "image/jpeg"
	| "image/webp"
	| "image/heic"
	| "image/heif"
	| "audio/wav"
	| "audio/mp3"
	| "audio/aiff"
	| "audio/aac"
	| "audio/ogg"
	| "audio/flac"
	| "video/mp4"
	| "video/mpeg"
	| "video/mov"
	| "video/avi"
	| "video/x-flv"
	| "video/mpg"
	| "video/webm"
	| "video/wmv"
	| "video/3gpp"
	| "text/plain"
	| "text/html"
	| "text/css"
	| "text/javascript"
	| "application/x-javascript"
	| "text/x-typescript"
	| "application/x-typescript"
	| "text/csv"
	| "text/markdown"
	| "text/x-python"
	| "application/x-python-code"
	| "application/json"
	| "text/xml"
	| "application/rtf"
	| "text/rtf"
	| "application/pdf";

type RemoteFilePart = { fileData: { mime_type: FileType; fileUri: string } };

type InlineFilePart = { inline_data: { mime_type: FileType; data: string } };

type TextPart = { text: string };

export type Part = TextPart | RemoteFilePart | InlineFilePart;

type Role = "user" | "model" | "system";

type SafetyRating = { category: string; probability: string };

export type Message = { parts: Part[]; role: Role };

export type FileUpload = { buffer: ArrayBuffer, filePath: string };
export function isFileUpload(data: any): data is FileUpload {
	return data && data.buffer && data.filePath;
}

export type PromptFeedback = {
	blockReason?: string;
	safetyRatings: SafetyRating[];
};

export type Candidate = {
	content: { parts: TextPart[]; role: Role };
	finishReason: string;
	index: number;
	safetyRatings: SafetyRating[];
};

export type GeminiResponse = {
	candidates: Candidate[];
	promptFeedback: PromptFeedback;
};

export enum Command {
	StreamGenerate = "streamGenerateContent",
	Generate = "generateContent",
	Embed = "embedContent",
	Count = "countTokens",
}

export enum HarmCategory {
	HateSpeech = "HARM_CATEGORY_HATE_SPEECH",
	SexuallyExplicit = "HARM_CATEGORY_SEXUALLY_EXPLICIT",
	Harassment = "HARM_CATEGORY_HARASSMENT",
	DangerousContent = "HARM_CATEGORY_DANGEROUS_CONTENT",
}

/**
 * The body used for the API call to generateContent or streamGenerateContent
 */
type GenerateContentBody = {
	contents: Message[];
	generationConfig: {
		maxOutputTokens: number;
		temperature: number;
		topP: number;
		topK: number;
		responseMimeType?: string;
		responseSchema?: Schema;
	};
	safetySettings: { category: HarmCategory; threshold: SafetyThreshold }[];
	systemInstruction?: Message;
};

/**
 * The response from the REST API to generateContent or streamGenerateContent
 */
type GenerateContentQueryOutput = {
	candidates: Candidate[];
	promptFeedback: PromptFeedback;
};

/**
 * The model used for an API call
 * If this is an array, the API will iterate through each model until one works
 */
export type Model = string | string[];

/**
 * The body used for the API call for each command
 */
export type QueryBodyMap = {
	[Command.StreamGenerate]: GenerateContentBody;
	[Command.Generate]: GenerateContentBody;
	[Command.Count]: { contents: Message[] };
	[Command.Embed]: { model: Model; content: Message };
};

/**
 * The response from the REST API for each command
 */
export type QueryResponseMap = {
	[Command.StreamGenerate]: GenerateContentQueryOutput;
	[Command.Generate]: GenerateContentQueryOutput;
	[Command.Embed]: {
		embedding: { values: number[] };
	};
	[Command.Count]: {
		totalTokens: number;
	};
};

// These types are also directly used, as a string, in the Gemini class static properties
// If you are to change these types, ensure to modify the statics in the Gemini class as well.
export type TextFormat = "text";
export type JSONFormat = "json";
export type Format = TextFormat | JSONFormat;

/**
 * The output format for each command.
 */
export type CommandResponseMap<F extends Format = TextFormat> = {
	[Command.StreamGenerate]: F extends JSONFormat
		? QueryResponseMap[Command.StreamGenerate]
		: string;
	[Command.Generate]: F extends JSONFormat
		? QueryResponseMap[Command.Generate]
		: string;
	[Command.Embed]: number[];
	[Command.Count]: number;
};

export type GeminiOptions = {
	fetch?: typeof fetch;
	apiVersion?: string;
	dispatcher?: ProxyAgent;
};

/**
 * The option format for each command.
 */
export type CommandOptionMap<F extends Format = TextFormat> = {
	[Command.Generate]: {
		temperature?: number;
		topP?: number;
		topK?: number;
		format: F;
		maxOutputTokens: number;
		model: Model;
		data: Buffer[];
		systemInstruction: string;
		safetySettings: {
			hate: SafetyThreshold;
			sexual: SafetyThreshold;
			harassment: SafetyThreshold;
			dangerous: SafetyThreshold;
		};
		messages: ([string, string] | Message)[];
		stream?(stream: CommandResponseMap<F>[Command.StreamGenerate]): void;
		jsonSchema: boolean | Schema;
	};
	[Command.Embed]: {
		model: Model;
	};
	[Command.Count]: {
		model: Model;
	};
};

export enum SafetyThreshold {
	// Content with NEGLIGIBLE will be allowed.
	BLOCK_MOST = "BLOCK_LOW_AND_ABOVE",
	// Content with NEGLIGIBLE and LOW will be allowed.
	BLOCK_SOME = "BLOCK_MEDIUM_AND_ABOVE",
	// Content with NEGLIGIBLE, LOW, and MEDIUM will be allowed.
	BLOCK_FEW = "BLOCK_ONLY_HIGH",
	// All content will be allowed.
	BLOCK_NONE = "BLOCK_NONE",
}

export type FormatType<T> = T extends JSONFormat ? GeminiResponse : string;

export type ChatOptions = {
	messages: [string, string][] | Message[];
	temperature?: number;
	topP?: number;
	topK?: number;
	model: Model;
	maxOutputTokens: number;
	systemInstruction: string;
};

export type ChatAskOptions<F extends Format = TextFormat> = {
	format: F;
	data: [];
	stream?(stream: CommandResponseMap<F>[Command.StreamGenerate]): void;
	jsonSchema: boolean | Schema;
};

export enum SchemaType {
	/** String type. */
	STRING = "STRING",
	/** Number type. */
	NUMBER = "NUMBER",
	/** Integer type. */
	INTEGER = "INTEGER",
	/** Boolean type. */
	BOOLEAN = "BOOLEAN",
	/** Array type. */
	ARRAY = "ARRAY",
	/** Object type. */
	OBJECT = "OBJECT",
}

/**
 * Schema is used to define the format of input/output data.
 * Represents a select subset of an OpenAPI 3.0 schema object.
 * More fields may be added in the future as needed.
 * @public
 */
export interface Schema {
	/**
	 * Optional. The type of the property. {@link
	 * FunctionDeclarationSchemaType}.
	 */
	type?: SchemaType;
	/** Optional. The format of the property. */
	format?: string;
	/** Optional. The description of the property. */
	description?: string;
	/** Optional. Whether the property is nullable. */
	nullable?: boolean;
	/** Optional. The items of the property. {@link FunctionDeclarationSchema} */
	items?: FunctionDeclarationSchema;
	/** Optional. The enum of the property. */
	enum?: string[];
	/** Optional. Map of {@link FunctionDeclarationSchema}. */
	properties?: { [k: string]: FunctionDeclarationSchema };
	/** Optional. Array of required property. */
	required?: string[];
	/** Optional. The example of the property. */
	example?: unknown;
}

/**
 * Schema for parameters passed to {@link FunctionDeclaration.parameters}.
 * @public
 */
interface FunctionDeclarationSchema {
	/** The type of the parameter. */
	type: SchemaType;
	/** The format of the parameter. */
	properties: { [k: string]: Schema };
	/** Optional. Description of the parameter. */
	description?: string;
	/** Optional. Array of required parameters. */
	required?: string[];
}
