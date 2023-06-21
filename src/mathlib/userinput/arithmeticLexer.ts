// Generated from ./src/mathlib/userinput/arithmetic.g4 by ANTLR 4.13.0
// noinspection ES6UnusedImports,JSUnusedGlobalSymbols,JSUnusedLocalSymbols
import {
	ATN,
	ATNDeserializer,
	CharStream,
	DecisionState, DFA,
	Lexer,
	LexerATNSimulator,
	RuleContext,
	PredictionContextCache,
	Token
} from "antlr4";
export default class arithmeticLexer extends Lexer {
	public static readonly VARIABLE = 1;
	public static readonly SCIENTIFIC_NUMBER = 2;
	public static readonly LPAREN = 3;
	public static readonly RPAREN = 4;
	public static readonly PLUS = 5;
	public static readonly MINUS = 6;
	public static readonly TIMES = 7;
	public static readonly DIV = 8;
	public static readonly GT = 9;
	public static readonly LT = 10;
	public static readonly EQ = 11;
	public static readonly POINT = 12;
	public static readonly POW = 13;
	public static readonly WS = 14;
	public static readonly EOF = Token.EOF;

	public static readonly channelNames: string[] = [ "DEFAULT_TOKEN_CHANNEL", "HIDDEN" ];
	public static readonly literalNames: (string | null)[] = [ null, null, 
                                                            null, "'('", 
                                                            "')'", "'+'", 
                                                            "'-'", "'*'", 
                                                            "'/'", "'>'", 
                                                            "'<'", "'='", 
                                                            "'.'", "'^'" ];
	public static readonly symbolicNames: (string | null)[] = [ null, "VARIABLE", 
                                                             "SCIENTIFIC_NUMBER", 
                                                             "LPAREN", "RPAREN", 
                                                             "PLUS", "MINUS", 
                                                             "TIMES", "DIV", 
                                                             "GT", "LT", 
                                                             "EQ", "POINT", 
                                                             "POW", "WS" ];
	public static readonly modeNames: string[] = [ "DEFAULT_MODE", ];

	public static readonly ruleNames: string[] = [
		"VARIABLE", "SCIENTIFIC_NUMBER", "NUMBER", "UNSIGNED_INTEGER", "E", "SIGN", 
		"LPAREN", "RPAREN", "PLUS", "MINUS", "TIMES", "DIV", "GT", "LT", "EQ", 
		"POINT", "POW", "WS",
	];


	constructor(input: CharStream) {
		super(input);
		this._interp = new LexerATNSimulator(this, arithmeticLexer._ATN, arithmeticLexer.DecisionsToDFA, new PredictionContextCache());
	}

	public get grammarFileName(): string { return "arithmetic.g4"; }

	public get literalNames(): (string | null)[] { return arithmeticLexer.literalNames; }
	public get symbolicNames(): (string | null)[] { return arithmeticLexer.symbolicNames; }
	public get ruleNames(): string[] { return arithmeticLexer.ruleNames; }

	public get serializedATN(): number[] { return arithmeticLexer._serializedATN; }

	public get channelNames(): string[] { return arithmeticLexer.channelNames; }

	public get modeNames(): string[] { return arithmeticLexer.modeNames; }

	public static readonly _serializedATN: number[] = [4,0,14,99,6,-1,2,0,7,
	0,2,1,7,1,2,2,7,2,2,3,7,3,2,4,7,4,2,5,7,5,2,6,7,6,2,7,7,7,2,8,7,8,2,9,7,
	9,2,10,7,10,2,11,7,11,2,12,7,12,2,13,7,13,2,14,7,14,2,15,7,15,2,16,7,16,
	2,17,7,17,1,0,1,0,1,1,1,1,1,1,3,1,43,8,1,1,1,1,1,3,1,47,8,1,1,2,4,2,50,
	8,2,11,2,12,2,51,1,2,1,2,4,2,56,8,2,11,2,12,2,57,3,2,60,8,2,1,3,4,3,63,
	8,3,11,3,12,3,64,1,4,1,4,1,5,1,5,1,6,1,6,1,7,1,7,1,8,1,8,1,9,1,9,1,10,1,
	10,1,11,1,11,1,12,1,12,1,13,1,13,1,14,1,14,1,15,1,15,1,16,1,16,1,17,4,17,
	94,8,17,11,17,12,17,95,1,17,1,17,0,0,18,1,1,3,2,5,0,7,0,9,0,11,0,13,3,15,
	4,17,5,19,6,21,7,23,8,25,9,27,10,29,11,31,12,33,13,35,14,1,0,4,2,0,65,90,
	97,122,2,0,69,69,101,101,2,0,43,43,45,45,3,0,9,10,13,13,32,32,101,0,1,1,
	0,0,0,0,3,1,0,0,0,0,13,1,0,0,0,0,15,1,0,0,0,0,17,1,0,0,0,0,19,1,0,0,0,0,
	21,1,0,0,0,0,23,1,0,0,0,0,25,1,0,0,0,0,27,1,0,0,0,0,29,1,0,0,0,0,31,1,0,
	0,0,0,33,1,0,0,0,0,35,1,0,0,0,1,37,1,0,0,0,3,39,1,0,0,0,5,49,1,0,0,0,7,
	62,1,0,0,0,9,66,1,0,0,0,11,68,1,0,0,0,13,70,1,0,0,0,15,72,1,0,0,0,17,74,
	1,0,0,0,19,76,1,0,0,0,21,78,1,0,0,0,23,80,1,0,0,0,25,82,1,0,0,0,27,84,1,
	0,0,0,29,86,1,0,0,0,31,88,1,0,0,0,33,90,1,0,0,0,35,93,1,0,0,0,37,38,7,0,
	0,0,38,2,1,0,0,0,39,46,3,5,2,0,40,42,3,9,4,0,41,43,3,11,5,0,42,41,1,0,0,
	0,42,43,1,0,0,0,43,44,1,0,0,0,44,45,3,7,3,0,45,47,1,0,0,0,46,40,1,0,0,0,
	46,47,1,0,0,0,47,4,1,0,0,0,48,50,2,48,57,0,49,48,1,0,0,0,50,51,1,0,0,0,
	51,49,1,0,0,0,51,52,1,0,0,0,52,59,1,0,0,0,53,55,5,46,0,0,54,56,2,48,57,
	0,55,54,1,0,0,0,56,57,1,0,0,0,57,55,1,0,0,0,57,58,1,0,0,0,58,60,1,0,0,0,
	59,53,1,0,0,0,59,60,1,0,0,0,60,6,1,0,0,0,61,63,2,48,57,0,62,61,1,0,0,0,
	63,64,1,0,0,0,64,62,1,0,0,0,64,65,1,0,0,0,65,8,1,0,0,0,66,67,7,1,0,0,67,
	10,1,0,0,0,68,69,7,2,0,0,69,12,1,0,0,0,70,71,5,40,0,0,71,14,1,0,0,0,72,
	73,5,41,0,0,73,16,1,0,0,0,74,75,5,43,0,0,75,18,1,0,0,0,76,77,5,45,0,0,77,
	20,1,0,0,0,78,79,5,42,0,0,79,22,1,0,0,0,80,81,5,47,0,0,81,24,1,0,0,0,82,
	83,5,62,0,0,83,26,1,0,0,0,84,85,5,60,0,0,85,28,1,0,0,0,86,87,5,61,0,0,87,
	30,1,0,0,0,88,89,5,46,0,0,89,32,1,0,0,0,90,91,5,94,0,0,91,34,1,0,0,0,92,
	94,7,3,0,0,93,92,1,0,0,0,94,95,1,0,0,0,95,93,1,0,0,0,95,96,1,0,0,0,96,97,
	1,0,0,0,97,98,6,17,0,0,98,36,1,0,0,0,8,0,42,46,51,57,59,64,95,1,6,0,0];

	private static __ATN: ATN;
	public static get _ATN(): ATN {
		if (!arithmeticLexer.__ATN) {
			arithmeticLexer.__ATN = new ATNDeserializer().deserialize(arithmeticLexer._serializedATN);
		}

		return arithmeticLexer.__ATN;
	}


	static DecisionsToDFA = arithmeticLexer._ATN.decisionToState.map( (ds: DecisionState, index: number) => new DFA(ds, index) );
}