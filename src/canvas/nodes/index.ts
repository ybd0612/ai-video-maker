import { PromptNode } from "./PromptNode";
import { TextNode } from "./TextNode";
import { ImageNode } from "./ImageNode";
import { VideoNode } from "./VideoNode";
import { UploadNode } from "./UploadNode";

export { PromptNode } from "./PromptNode";
export { TextNode } from "./TextNode";
export { ImageNode } from "./ImageNode";
export { VideoNode } from "./VideoNode";
export { UploadNode } from "./UploadNode";

export const nodeTypes = {
  prompt: PromptNode,
  text: TextNode,
  image: ImageNode,
  video: VideoNode,
  upload: UploadNode,
};
