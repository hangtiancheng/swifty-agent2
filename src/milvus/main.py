from pymilvus import MilvusClient

client = MilvusClient("demo.db")

if client.has_collection(collection_name="demo"):
    client.drop_collection(collection_name="demo")

client.create_collection(
    collection_name="demo",
    dimension=768,  # The vectors we will use in this demo has 768 dimensions
)
