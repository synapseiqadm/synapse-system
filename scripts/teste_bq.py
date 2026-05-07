import os
from google.cloud import bigquery

os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = os.path.join(
    os.path.dirname(__file__), "credentials.json"
)

client = bigquery.Client()

print(f"Projeto: {client.project}\n")

datasets = list(client.list_datasets())

if datasets:
    print(f"{len(datasets)} dataset(s) encontrado(s):")
    for ds in datasets:
        print(f"  - {ds.dataset_id}")
else:
    print("Nenhum dataset encontrado no projeto.")
