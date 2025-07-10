from py_pdf_parser.loaders import load_file
import chromadb
import ollama
import numpy as np
import os
import re

def extract_pdf_elements(pdfpath, savepath):
    document = load_file(pdfpath)
    texts = [element.text() for element in document.elements]
    return texts

def store_no_embed(texts, pdfpath):
    client = chromadb.PersistentClient(path=r"./chromadb")
    collection = client.get_or_create_collection(name="call_centre_docs")

    ids = create_ids(pdfpath, 0, len(texts))

    collection.add(documents=texts, ids=ids)
    return collection

def retrieve_relevant_chunks(query, collection, top_k=3):
    results = collection.query(query_texts=[query], n_results=top_k)
    return results["documents"][0]

def generate_answer(query, relevant_chunks, model):
    context = "\n".join(relevant_chunks)
    answer = ollama.generate(
        model=model,
        prompt=f'{query} Look at this conversation and generate useful advice for the call centre agent to help him navigate the conversation using this information: {context}'
    )
    return answer['response']

def generate_advice_agent(query, relevant_chunks, model):
    context = "\n".join(relevant_chunks)
    answer = ollama.generate(
        model=model,
        prompt=f'{query} Look at this feedback given by a customer and generate useful advice for the call centre agent to help him do better in his future conversations using this information: {context}'
    )
    return answer['response']

# def generate_csv_file(transcript, model):
#     name_customer = ollama.generate(
#         model=model,
#         prompt=f'{transcript} Look at this conversation and ONLY AND ONLY GIVE ME THE NAME OF THE CUSTOMER.'
#     )
#     name_customer = re.sub(r"<think>.*?</think>", "", name_customer['response'], flags=re.DOTALL)

#     conv_summary = ollama.generate(
#         model=model,
#         prompt=f'{transcript} Look at this conversation and summarize the conversation in not more than 5 lines.'
#     )
#     conv_summary = re.sub(r"<think>.*?</think>", "", conv_summary['response'], flags=re.DOTALL)

#     return name_customer.strip(), conv_summary.strip()

import os
import csv
import re
import ollama

def generate_csv_file(transcript, model):
    # Extract customer name
    name_customer = ollama.generate(
        model=model,
        prompt=f'{transcript} Look at this conversation and ONLY AND ONLY GIVE ME THE NAME OF THE CUSTOMER.'
    )
    name_customer = re.sub(r"<think>.*?</think>", "", name_customer['response'], flags=re.DOTALL).strip()

    # Generate summary
    conv_summary = ollama.generate(
        model=model,
        prompt=f'{transcript} Look at this conversation and summarize the conversation in not more than 5 lines.'
    )
    conv_summary = re.sub(r"<think>.*?</think>", "", conv_summary['response'], flags=re.DOTALL).strip()

    # Create output folder
    os.makedirs("csv_outputs", exist_ok=True)
    filename = f"{name_customer.replace(' ', '_')}_summary.csv"
    filepath = os.path.join("csv_outputs", filename)

    # Write to CSV
    with open(filepath, mode="w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["Customer Name", "Conversation Summary"])
        writer.writerow([name_customer, conv_summary])

    return filename, filepath


def delete_all_files(folder_path):
    if not os.path.isdir(folder_path):
        raise ValueError(f"'{folder_path}' is not a valid directory")

    for filename in os.listdir(folder_path):
        file_path = os.path.join(folder_path, filename)
        if os.path.isfile(file_path):
            os.remove(file_path)

def inference(query, model):
    client = chromadb.PersistentClient(path=r"./chromadb")
    collection = client.get_or_create_collection(name="call_centre_docs")
    relevant_chunks = retrieve_relevant_chunks(query, collection, top_k=3)
    return generate_answer(query, relevant_chunks, model)

def inference_advice(query, model):
    client = chromadb.PersistentClient(path=r"./chromadb")
    collection = client.get_or_create_collection(name="call_centre_docs")
    relevant_chunks = retrieve_relevant_chunks(query, collection, top_k=3)
    return generate_advice_agent(query, relevant_chunks, model)

def create_ids(pdfpath, start, stop):
    filename = os.path.basename(pdfpath)
    paper_title = os.path.splitext(filename)[0]
    return [f"{filename}-id{i}" for i in range(start, stop)]
