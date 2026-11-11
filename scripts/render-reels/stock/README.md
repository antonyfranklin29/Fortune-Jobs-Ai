# Stock imagery and narration for Reels 52–81

The stills are cropped and labelled “Stock photo” in the video. They illustrate the subject of each post. The captions make no claim about the people pictured. Source files have been resized and saved without camera metadata. All five photos use the [Pexels license](https://www.pexels.com/license/).

| File | Source |
|---|---|
| `4560083.jpg` | [Student with documents and laptop outdoors](https://www.pexels.com/photo/student-with-documents-and-laptop-happy-about-getting-into-university-4560083/) |
| `5553049.jpg` | [Students working together on a laptop](https://www.pexels.com/photo/positive-multiethnic-students-using-laptop-for-studies-5553049/) |
| `6684514.jpg` | [Students studying together in a library](https://www.pexels.com/photo/a-college-student-using-a-laptop-6684514/) |
| `5538007.jpg` | [Student with a laptop near a campus wall](https://www.pexels.com/photo/joyful-asian-female-student-leaning-on-university-brick-wall-5538007/) |
| `6147047.jpg` | [Student walking on campus steps](https://www.pexels.com/photo/young-ethnic-smart-student-with-laptop-near-university-6147047/) |

Reels 52, 57, 62, 67, 72, and 77 use the Piper `en_US-ljspeech-medium` narrator. The stock photo stays still, and the caption shows the exact script. The model card identifies the training recordings as public-domain. [Piper voice model card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/ljspeech/medium/MODEL_CARD)

With the existing Python, Pillow, NumPy and FFmpeg requirements, install `piper-tts` and download the [model and matching JSON configuration](https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US/ljspeech/medium) to a local directory outside the repo. Run from the repository root.

```sh
python scripts/render-reels/render_students.py --voice-model /path/to/en_US-ljspeech-medium.onnx
```

The renderer uses the same four original music loops and reads the branded outro from Reel 00. It renders IDs 52–81 and appends the entries to `reels.json` and the Make-compatible `reels-feed.json`. Add `--ids 52 53` to preview a subset without updating either feed.
