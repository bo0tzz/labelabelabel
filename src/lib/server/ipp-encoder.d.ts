declare module 'ipp-encoder' {
	interface Attribute {
		tag: number;
		name: string;
		value: unknown;
	}
	interface Group {
		tag: number;
		attributes: Attribute[];
	}
	interface Message {
		version: { major: number; minor: number };
		requestId: number;
		groups: Group[];
		data?: Buffer;
	}
	const ipp: {
		CONSTANTS: Record<string, number>;
		request: { encode(message: Message & { operationId: number }): Buffer };
		response: { decode(buffer: Buffer): Message & { statusCode: number } };
	};
	export default ipp;
}
