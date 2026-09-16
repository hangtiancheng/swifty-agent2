from pymilvus import MilvusClient

client = MilvusClient("milvus-lite.db")

if client.has_collection(collection_name="knowledge"):
    client.drop_collection(collection_name="knowledge")

client.create_collection(
    collection_name="knowledge",
    dimension=768,  # The vectors we will use in this demo has 768 dimensions
)
