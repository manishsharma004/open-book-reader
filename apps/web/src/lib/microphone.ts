/** Why a page cannot open the microphone. Empty when a prompt can appear. */
export function microphoneBlock(secure: boolean, hasMicrophone: boolean, page: string): string {
	if (!secure) {
		return `This page is ${page}. Chrome on a phone only shows the microphone prompt for HTTPS or localhost, so that sheet cannot appear. Choose an audio file instead.`;
	}
	if (!hasMicrophone) return 'This browser has no microphone API. Choose an audio file instead.';
	return '';
}
