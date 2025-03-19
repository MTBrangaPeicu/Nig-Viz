import torch
import logging
from transformers import AutoModelForSequenceClassification, AutoTokenizer

from utils import visualize_token_attrs, generate_baseline_with_padded_query_and_passage_but_special_tokens
from integrated_gradients import integrated_gradients

if __name__ == '__main__':
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = AutoModelForSequenceClassification.from_pretrained("castorini/monobert-large-msmarco").to(device)
    model.eval()

    tokenizer = AutoTokenizer.from_pretrained("bert-base-uncased")

    # Prepare the input
    query = "what was the immediate impact of the success of the manhattan project?"  # "what do the xylem and the phloem do"
    passage = "The Manhattan Project and its atomic bomb helped bring an end to World War II. Its legacy of peaceful uses of atomic energy continues to have an impact on history and science."
    passage1 = "Xylem transports water and soluble mineral nutrients from roots to various parts of the plant. It is responsible for replacing water lost through transpiration and photosynthesis. Phloem translocates sugars made by photosynthetic areas of plants to storage organs like roots, tubers or bulbs."

    inputs = tokenizer(
        query,
        passage,
        max_length=512,
        truncation=True,
        padding=True,
        return_attention_mask=True,
        return_tensors="pt"
    ).to(device)

    embeddings = model.bert.get_input_embeddings()
    input_embeds = embeddings(inputs["input_ids"])

    # Baseline gradient
    logging.info("### Baseline ###")
    baseline_inputs = inputs.copy()
    baseline_inputs["input_ids"] = generate_baseline_with_padded_query_and_passage_but_special_tokens(tokenizer,
                                                                                                      baseline_inputs[
                                                                                                          "input_ids"])

    baseline_embeds = embeddings(baseline_inputs["input_ids"].to(device))

    ig = integrated_gradients(
        model=model,
        input_embeddings=input_embeds,
        token_type_ids=inputs["token_type_ids"],
        attention_mask=inputs["attention_mask"],
        baseline_embeddings=baseline_embeds,
        num_reps=20,
        batch_size=10,
        pred_positif=True,
    )

    html_path = "./html_text_manthan_x_xylem_and_phloem.html"
    visualize_token_attrs(tokenizer.convert_ids_to_tokens(inputs["input_ids"][0]), ig, html_path)
